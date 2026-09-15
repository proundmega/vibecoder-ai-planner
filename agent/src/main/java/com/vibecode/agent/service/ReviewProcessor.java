package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.model.Ticket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.*;

/**
 * Reviews PRs for tickets that are in "review" status.
 * Fetches the PR diff, uses AI to analyze the code, and posts review comments.
 */
public class ReviewProcessor {

    private static final Logger log = LoggerFactory.getLogger(ReviewProcessor.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final ApiService apiService;
    private final AiProvider aiProvider;
    private final String agentId;

    public ReviewProcessor(ApiService apiService, AiProvider aiProvider, String agentId) {
        this.apiService = apiService;
        this.aiProvider = aiProvider;
        this.agentId = agentId;
    }

    /**
     * Process all tickets in review status.
     */
    public void processReviewCycle() throws IOException {
        log.info("Starting review cycle...");
        
        List<Ticket> reviewTickets = apiService.listReviewTickets();
        log.info("Found {} tickets in review status", reviewTickets.size());
        
        for (Ticket ticket : reviewTickets) {
            try {
                processReview(ticket);
            } catch (Exception e) {
                log.error("Error reviewing ticket {}: {}", ticket.getId(), e.getMessage());
                try {
                    apiService.postMessage(ticket.getId(), "status",
                        "Review failed: " + e.getMessage());
                } catch (IOException e2) {
                    log.error("Failed to post error message: {}", e2.getMessage());
                }
            }
        }
        
        log.info("Review cycle complete");
    }

    /**
     * Review a single ticket.
     */
    private void processReview(Ticket ticket) throws IOException {
        log.info("Reviewing ticket {}: {}", ticket.getId(), ticket.getTitle());
        
        // Post review started message
        apiService.postMessage(ticket.getId(), "status",
            "Review agent started analyzing PR...");
        
        // Get PR diff
        Map<String, Object> diffData = apiService.getPRDiff(ticket.getId());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) diffData.get("files");
        
        if (files == null || files.isEmpty()) {
            log.warn("No files in PR diff for ticket {}", ticket.getId());
            apiService.postMessage(ticket.getId(), "status",
                "No files found in PR diff");
            return;
        }
        
        // Build review prompt with file contents
        StringBuilder prompt = new StringBuilder();
        prompt.append("Review the following code changes for the ticket: \"").append(ticket.getTitle()).append("\"\n\n");
        
        for (Map<String, Object> file : files) {
            String filename = (String) file.get("filename");
            String patch = (String) file.get("patch");
            String status = (String) file.get("status");
            
            prompt.append("## File: ").append(filename).append(" (").append(status).append(")\n\n");
            prompt.append("```\n").append(patch).append("\n```\n\n");
        }
        
        prompt.append("\n## Review Checklist\n");
        prompt.append("1. Code quality and readability\n");
        prompt.append("2. Security issues (XSS, injection, etc.)\n");
        prompt.append("3. Performance concerns\n");
        prompt.append("4. Missing error handling\n");
        prompt.append("5. adherence to the implementation plan\n");
        prompt.append("6. Test coverage considerations\n\n");
        prompt.append("## Output Format\n");
        prompt.append("Return a JSON object with this structure:\n");
        prompt.append("{\n");
        prompt.append("  \"approved\": true/false,\n");
        prompt.append("  \"summary\": \"Brief summary of the review\",\n");
        prompt.append("  \"issues\": [\n");
        prompt.append("    {\n");
        prompt.append("      \"severity\": \"critical|warning|info\",\n");
        prompt.append("      \"file\": \"filename.js\",\n");
        prompt.append("      \"line\": 42,\n");
        prompt.append("      \"message\": \"Description of the issue\"\n");
        prompt.append("    }\n");
        prompt.append("  ],\n");
        prompt.append("  \"suggestions\": [\"Suggestion 1\", \"Suggestion 2\"]\n");
        prompt.append("}\n");
        
        // Generate review using AI
        log.info("Sending review request to AI...");
        String reviewJson = aiProvider.generateResponse(
            "You are a senior code reviewer. Review the code changes carefully and provide constructive feedback. Always return valid JSON.",
            prompt.toString()
        );
        
        log.info("AI review response received, parsing...");
        
        // Parse and post review
        parseAndPostReview(ticket.getId(), reviewJson);
        
        // Update ticket status based on review
        boolean approved = isApproved(reviewJson);
        if (approved) {
            apiService.updateTicketStatus(ticket.getId(), "done");
            apiService.postMessage(ticket.getId(), "status",
                "Review passed - ticket marked as done");
        } else {
            apiService.postMessage(ticket.getId(), "status",
                "Review completed with issues - see comments");
        }
        
        log.info("Review complete for ticket {}", ticket.getId());
    }

    /**
     * Parse the AI review response and post comments.
     */
    private void parseAndPostReview(Long ticketId, String reviewJson) throws IOException {
        try {
            // Extract JSON from response
            String json = extractJson(reviewJson);
            JsonNode root = objectMapper.readTree(json);
            
            boolean approved = root.path("approved").asBoolean(false);
            String summary = root.path("summary").asText("No summary provided");
            
            // Post summary
            apiService.postMessage(ticketId, "status",
                "Review " + (approved ? "PASSED" : "COMPLETED") + "\n" + summary);
            
            // Post individual issues
            JsonNode issues = root.path("issues");
            if (issues.isArray()) {
                for (JsonNode issue : issues) {
                    String severity = issue.path("severity").asText("info");
                    String file = issue.path("file").asText("unknown");
                    int line = issue.path("line").asInt(0);
                    String message = issue.path("message").asText("No message");
                    
                    String comment = String.format("[%s] %s:%d - %s",
                        severity.toUpperCase(), file, line, message);
                    
                    apiService.postMessage(ticketId, "comment", comment);
                }
            }
            
            // Post suggestions
            JsonNode suggestions = root.path("suggestions");
            if (suggestions.isArray() && suggestions.size() > 0) {
                StringBuilder suggestionText = new StringBuilder("Suggestions:\n");
                for (JsonNode suggestion : suggestions) {
                    suggestionText.append("- ").append(suggestion.asText()).append("\n");
                }
                apiService.postMessage(ticketId, "comment", suggestionText.toString());
            }
            
        } catch (Exception e) {
            log.error("Failed to parse review JSON: {}", e.getMessage());
            apiService.postMessage(ticketId, "comment",
                "Review analysis: " + reviewJson.substring(0, Math.min(500, reviewJson.length())));
        }
    }

    /**
     * Extract JSON from AI response (handles markdown code blocks).
     */
    private String extractJson(String response) {
        // Try to find JSON in markdown code blocks
        int firstBrace = response.indexOf('{');
        int lastBrace = response.lastIndexOf('}');
        
        if (firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace) {
            return response.substring(firstBrace, lastBrace + 1);
        }
        
        return response;
    }

    /**
     * Check if the review indicates approval.
     */
    private boolean isApproved(String reviewJson) {
        try {
            String json = extractJson(reviewJson);
            JsonNode root = objectMapper.readTree(json);
            return root.path("approved").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }
}
