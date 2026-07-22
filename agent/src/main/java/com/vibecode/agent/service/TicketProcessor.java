package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.FileOperation;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Core ticket processing logic.
 * Orchestrates: pick up ticket -> fetch planning -> generate code -> clone repo -> write files -> commit -> create PR -> update status.
 */
public class TicketProcessor {

    private static final Logger log = LoggerFactory.getLogger(TicketProcessor.class);

    private final AgentConfig config;
    private final ApiService apiService;
    private final AiProvider aiProvider;
    private final GitHubService gitHubService;
    private final WorkspaceManager workspaceManager;
    private final ObjectMapper objectMapper;

    // Tracking variables for heartbeat reporting
    private String currentTicketId = null;
    private String currentStep = null;

    public String getCurrentTicketId() {
        return currentTicketId;
    }

    public String getCurrentStep() {
        return currentStep;
    }

    public TicketProcessor(AgentConfig config, ApiService apiService, AiProvider aiProvider, GitHubService gitHubService) {
        this.config = config;
        this.apiService = apiService;
        this.aiProvider = aiProvider;
        this.gitHubService = gitHubService;
        this.workspaceManager = new WorkspaceManager(
            config.getRepoCloneDir(),
            config.getRepoName(),
            config.isDryRun()
        );
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Process a single ticket from start to finish.
     * 1. Pick up the ticket
     * 2. Fetch planning docs
     * 3. Generate code/plan using AI (with workspace context)
     * 4. Parse AI output into file operations
     * 5. Clone repo if needed
     * 6. Write files to workspace
     * 7. Commit and push
     * 8. Create PR (if not dry run)
     * 9. Update ticket status to 'review'
     */
    public void processTicket(Ticket ticket) {
        log.info("Processing ticket: {} - {}", ticket.getId(), ticket.getTitle());

        // Step 1: Pick up the ticket
        Ticket pickedUp = pickUpTicket(ticket.getId());
        if (pickedUp == null) {
            log.warn("Could not pick up ticket {}, skipping", ticket.getId());
            return;
        }
        log.info("Ticket {} picked up, status: {}", ticket.getId(), pickedUp.getStatus());

        // Post "started working" message BEFORE processing
        try {
            apiService.postMessage(pickedUp.getId(), "update",
                "Started working on: " + pickedUp.getTitle());
        } catch (IOException e) {
            log.warn("Failed to post started message: {}", e.getMessage());
        }

        // Set tracking variables for heartbeat reporting
        currentTicketId = String.valueOf(pickedUp.getId());
        currentStep = "processing";

        try {
            // Step 2: Fetch planning docs
            List<String> planningDocs = fetchPlanningDocs(pickedUp.getId());
            log.info("Fetched {} planning documents", planningDocs.size());

            // Step 3: Generate code/plan using AI (skip in dry run)
            String generatedContent = null;
            if (!config.isDryRun()) {
                generatedContent = generateContent(pickedUp, planningDocs);
                log.info("AI generated content for ticket {}", ticket.getId());
            } else {
                log.info("[DRY RUN] Would generate content for ticket {}", ticket.getId());
            }

            // Step 4: Parse AI output into file operations
            ParsedResult parsedResult = parseFileOperationsWithStatus(generatedContent);
            List<FileOperation> fileOperations = parsedResult.operations;
            boolean parseFailed = parsedResult.failed;

            if (parseFailed) {
                apiService.postMessage(pickedUp.getId(), "update",
                    "Error: AI response could not be parsed as valid JSON with file operations. AI output may be malformed.");
                throw new IOException("AI response parse failed - could not extract file operations");
            }

            log.info("Parsed {} file operations from AI output", fileOperations.size());

            // Step 5: Clone repo if needed
            String branchName = config.getGitHubBranchName(pickedUp.getId(), pickedUp.getTitle());
            if (!config.isDryRun()) {
                workspaceManager.cloneRepo(
                    "https://github.com/" + config.getRepoOwner() + "/" + config.getRepoName() + ".git",
                    branchName
                );
            }

            // Step 6: Write files to workspace
            if (!config.isDryRun()) {
                workspaceManager.writeFiles(fileOperations);
            }

            // Step 7: Commit and push (if not dry run)
            String commitSha = null;
            if (!config.isDryRun() && !fileOperations.isEmpty()) {
                String commitMessage = "feat: " + pickedUp.getTitle();
                commitSha = workspaceManager.commitAndPush(commitMessage, branchName);
                log.info("Committed and pushed: {}", commitSha);
            } else {
                log.info("[DRY RUN] Would commit and push");
            }

            // Step 9: Create PR (if not dry run)
            String prUrl = null;
            if (!config.isDryRun()) {
                String prTitle = "feat: " + pickedUp.getTitle();
                String prBody = buildPrBody(pickedUp, branchName, commitSha, fileOperations);
                prUrl = gitHubService.createPullRequest(prTitle, prBody, branchName, "main");
                log.info("Created PR: {}", prUrl);
            } else {
                log.info("[DRY RUN] Would create PR for branch: {}", branchName);
            }

            // Step 10: Post final message and update status
            String finalMessage = "Completed: " + pickedUp.getTitle();
            if (prUrl != null) {
                finalMessage += ". PR: " + prUrl;
            }
            apiService.postMessage(pickedUp.getId(), "status", finalMessage);

            apiService.updateTicketStatus(pickedUp.getId(), "review");
            log.info("Ticket {} status updated to review", pickedUp.getId());

            // Reset state after successful completion
            currentTicketId = null;
            currentStep = null;

        } catch (Exception e) {
            log.error("Error processing ticket {}: {}", ticket.getId(), e.getMessage(), e);
            // Post error message
            try {
                apiService.postMessage(ticket.getId(), "update",
                    "Error processing ticket: " + e.getMessage());
            } catch (IOException ioException) {
                log.error("Failed to post error message", ioException);
            }
            // Release the ticket so another agent can try
            try {
                apiService.releaseTicket(ticket.getId());
                log.info("Released ticket {} after error", ticket.getId());
            } catch (IOException releaseException) {
                log.error("Failed to release ticket {}", ticket.getId(), releaseException);
            }
        }
    }

    private Ticket pickUpTicket(Long ticketId) {
        try {
            return apiService.pickUpTicket(ticketId);
        } catch (IOException e) {
            log.warn("Could not pick up ticket {}: {}", ticketId, e.getMessage());
            return null;
        }
    }

    private List<String> fetchPlanningDocs(Long ticketId) throws IOException {
        List<String> docs = new ArrayList<>();
        try {
            String url = config.getApiUrl() + "/v1/tickets/" + ticketId + "/planning";
            Request request = new Request.Builder()
                .url(url)
                .header("X-API-Key", config.getAgentApiKey())
                .header("Accept", "application/json")
                .get()
                .build();

            try (Response response = apiService.getHttpClient().newCall(request).execute()) {
                
                if (!response.isSuccessful()) {
                    log.warn("Failed to fetch planning docs for ticket {}: {}", ticketId, response.code());
                    return docs;
                }
                
                JsonNode root = objectMapper.readTree(response.body().string());
                JsonNode files = root.path("data");
                
                if (files.isArray()) {
                    for (JsonNode file : files) {
                        String fileKey = file.path("file_key").asText("");
                        String content = file.path("content").asText("");
                        docs.add("=== " + fileKey + " ===\n" + content);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Error fetching planning docs for ticket {}: {}", ticketId, e.getMessage());
        }
        return docs;
    }

    private String generateContent(Ticket ticket, List<String> planningDocs) throws IOException {
        List<String> fileContext = null;
        try {
            fileContext = workspaceManager.getRepoFileList();
        } catch (IOException e) {
            log.warn("Could not read repo file list: {}", e.getMessage());
        }
        String systemPrompt = buildSystemPrompt(ticket, planningDocs, fileContext);
        String userMessage = "Ticket: " + ticket.getTitle() + "\n\n" + ticket.getDescription();
        
        long startTime = System.currentTimeMillis();
        String generatedContent = aiProvider.generateResponse(systemPrompt, userMessage);
        long durationMs = System.currentTimeMillis() - startTime;
        
        try {
            apiService.reportUsage(
                config.getAgentId(),
                aiProvider.getType(),
                config.getAiModel(),
                aiProvider.getTokensIn(),
                aiProvider.getTokensOut(),
                durationMs,
                ticket.getId()
            );
        } catch (Exception e) {
            log.warn("Failed to report usage for ticket {}: {}", ticket.getId(), e.getMessage());
        }
        
        return generatedContent;
    }

    private String buildSystemPrompt(Ticket ticket, List<String> planningDocs, List<String> fileContext) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("You are a coding agent working on the Vibecode platform. ");
        prompt.append("Your job is to implement the requirements described in the ticket. ");
        prompt.append("Project: ").append(config.getProjectId()).append(". ");
        prompt.append("Repository: ").append(config.getRepoOwner()).append("/").append(config.getRepoName()).append(". ");
        prompt.append("Use the AI provider: ").append(config.getAiProvider()).append(" with model: ").append(config.getAiModel()).append(". ");
        prompt.append("Follow best practices and write clean, maintainable code.\n\n");
        
        if (fileContext != null && !fileContext.isEmpty()) {
            prompt.append("## Repository Structure\n\n");
            prompt.append("Current files in the repository:\n");
            for (String file : fileContext) {
                prompt.append("- `").append(file).append("`\n");
            }
            prompt.append("\n");
        }
        
        if (!planningDocs.isEmpty()) {
            prompt.append("## Planning Documents\n\n");
            for (String doc : planningDocs) {
                prompt.append(doc).append("\n\n");
            }
        }
        
        prompt.append("## Output Format\n\n");
        prompt.append("You MUST return your response as a JSON object with this exact schema:\n\n");
        prompt.append("```json\n");
        prompt.append("{\n");
        prompt.append("  \"commit_message\": \"feat: implement ticket feature\",\n");
        prompt.append("  \"files\": [\n");
        prompt.append("    {\n");
        prompt.append("      \"path\": \"src/path/to/file.ext\",\n");
        prompt.append("      \"content\": \"full file content here\",\n");
        prompt.append("      \"action\": \"create\"\n");
        prompt.append("    },\n");
        prompt.append("    {\n");
        prompt.append("      \"path\": \"src/path/to/existing.ext\",\n");
        prompt.append("      \"content\": \"modified file content\",\n");
        prompt.append("      \"action\": \"modify\"\n");
        prompt.append("    },\n");
        prompt.append("    {\n");
        prompt.append("      \"path\": \"src/path/to/delete.ext\",\n");
        prompt.append("      \"action\": \"delete\"\n");
        prompt.append("    }\n");
        prompt.append("  ]\n");
        prompt.append("}\n");
        prompt.append("```\n\n");
        prompt.append("Rules:\n");
        prompt.append("- For CREATE: provide full file content\n");
        prompt.append("- For MODIFY: provide the complete modified file content\n");
        prompt.append("- For DELETE: only provide path and action\n");
        prompt.append("- Include ALL files that need to be created, modified, or deleted\n");
        prompt.append("- Do NOT include any text outside the JSON object\n");
        
        return prompt.toString();
    }

    private List<FileOperation> parseFileOperations(String aiResponse) {
        ParsedResult result = parseFileOperationsWithStatus(aiResponse);
        return result.operations;
    }

    private ParsedResult parseFileOperationsWithStatus(String aiResponse) {
        List<FileOperation> operations = new ArrayList<>();
        boolean failed = false;
        
        if (aiResponse == null || aiResponse.isBlank()) {
            log.warn("AI response is empty, no file operations");
            return new ParsedResult(operations, true);
        }

        try {
            // Extract JSON from response (handle markdown code blocks)
            String jsonContent = aiResponse.trim();
            
            // Remove markdown code blocks if present
            if (jsonContent.startsWith("```")) {
                int firstNewline = jsonContent.indexOf('\n');
                if (firstNewline != -1) {
                    jsonContent = jsonContent.substring(firstNewline + 1);
                }
                if (jsonContent.endsWith("```")) {
                    jsonContent = jsonContent.substring(0, jsonContent.length() - 3).trim();
                }
            }
            
            JsonNode root = objectMapper.readTree(jsonContent);
            JsonNode files = root.path("files");
            
            if (!files.isArray()) {
                log.warn("AI response does not contain 'files' array");
                return new ParsedResult(operations, true);
            }
            
            for (JsonNode fileNode : files) {
                String path = fileNode.path("path").asText("");
                String content = fileNode.path("content").asText("");
                String actionStr = fileNode.path("action").asText("create");
                String search = fileNode.has("search") ? fileNode.path("search").asText("") : null;
                
                FileOperation.Action action;
                try {
                    action = FileOperation.Action.valueOf(actionStr.toUpperCase());
                } catch (IllegalArgumentException e) {
                    log.warn("Unknown file action '{}', defaulting to CREATE", actionStr);
                    action = FileOperation.Action.CREATE;
                }
                
                FileOperation fileOp = new FileOperation(path, content, action);
                if (search != null) {
                    fileOp.setSearch(search);
                }
                operations.add(fileOp);
            }
            
        } catch (Exception e) {
            log.error("Failed to parse AI response as JSON: {}", e.getMessage());
            failed = true;
        }
        
        return new ParsedResult(operations, failed);
    }

    private static class ParsedResult {
        final List<FileOperation> operations;
        final boolean failed;

        ParsedResult(List<FileOperation> operations, boolean failed) {
            this.operations = operations;
            this.failed = failed;
        }
    }

    private String buildPrBody(Ticket ticket, String branchName, String commitSha, List<FileOperation> fileOperations) {
        StringBuilder body = new StringBuilder();
        body.append("## Ticket\n");
        body.append("**Title:** ").append(ticket.getTitle()).append("\n");
        body.append("**Description:** ").append(ticket.getDescription()).append("\n\n");
        
        if (commitSha != null) {
            body.append("**Commit:** `").append(commitSha).append("`\n\n");
        }
        
        body.append("## Changes\n");
        body.append("- Branch: `").append(branchName).append("`\n");
        
        if (fileOperations != null && !fileOperations.isEmpty()) {
            body.append("- Files changed: ").append(fileOperations.size()).append("\n");
            for (FileOperation op : fileOperations) {
                body.append("  - ").append(op.getAction()).append(": `").append(op.getPath()).append("`\n");
            }
        }
        
        body.append("- Generated by Vibecode AI Agent\n\n");
        body.append("## Checklist\n");
        body.append("- [ ] Code follows project conventions\n");
        body.append("- [ ] Tests pass\n");
        body.append("- [ ] No breaking changes");
        
        return body.toString();
    }
}
