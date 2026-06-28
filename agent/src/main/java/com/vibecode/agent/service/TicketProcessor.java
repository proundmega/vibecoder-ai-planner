package com.vibecode.agent.service;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

/**
 * Core ticket processing logic.
 * Orchestrates: pick up ticket → generate code → create branch → create PR → update status.
 */
public class TicketProcessor {

    private static final Logger log = LoggerFactory.getLogger(TicketProcessor.class);

    private final AgentConfig config;
    private final ApiService apiService;
    private final AiProvider aiProvider;
    private final GitHubService gitHubService;
    private String currentTicketId;
    private String currentStep;

    public TicketProcessor(AgentConfig config, ApiService apiService, AiProvider aiProvider, GitHubService gitHubService) {
        this.config = config;
        this.apiService = apiService;
        this.aiProvider = aiProvider;
        this.gitHubService = gitHubService;
    }

    public String getCurrentTicketId() {
        return currentTicketId;
    }

    public String getCurrentStep() {
        return currentStep;
    }

    /**
     * Process a single ticket from start to finish.
     * 1. Pick up the ticket
     * 2. Generate code/plan using AI
     * 3. Create GitHub branch
     * 4. Post progress messages
     * 5. Create PR (if not dry run)
     * 6. Update ticket status to 'review'
     */
    public void processTicket(Ticket ticket) {
        log.info("Processing ticket: {} - {}", ticket.getId(), ticket.getTitle());
        currentTicketId = String.valueOf(ticket.getId());

        // Step 1: Pick up the ticket
        Ticket pickedUp = pickUpTicket(ticket.getId());
        if (pickedUp == null) {
            log.warn("Could not pick up ticket {}, skipping", ticket.getId());
            currentTicketId = null;
            currentStep = null;
            return;
        }
        log.info("Ticket {} picked up, status: {}", ticket.getId(), pickedUp.getStatus());
        currentStep = "picked_up";

        try {
            // Step 2: Generate code/plan using AI (skip in dry run)
            String generatedContent = null;
            if (!config.isDryRun()) {
                currentStep = "generating_content";
                generatedContent = generateContent(pickedUp);
                log.info("AI generated content for ticket {}", ticket.getId());
            } else {
                log.info("[DRY RUN] Would generate content for ticket {}", ticket.getId());
            }

            // Step 3: Create GitHub branch
            String branchName = config.getGitHubBranchName(pickedUp.getId(), pickedUp.getTitle());
            currentStep = "creating_branch";
            if (!config.isDryRun()) {
                gitHubService.createBranch(branchName, "main");
                log.info("Created branch: {}", branchName);
            } else {
                log.info("[DRY RUN] Would create branch: {}", branchName);
            }

            // Step 4: Post progress message
            currentStep = "posting_message";
            apiService.postMessage(pickedUp.getId(), "update",
                "Started working on: " + pickedUp.getTitle());

            // Step 5: Create PR (if not dry run)
            String prUrl = null;
            if (!config.isDryRun()) {
                currentStep = "creating_pr";
                String prTitle = "feat: " + pickedUp.getTitle();
                String prBody = buildPrBody(pickedUp, branchName);
                prUrl = gitHubService.createPullRequest(prTitle, prBody, branchName, "main");
                log.info("Created PR: {}", prUrl);
            } else {
                log.info("[DRY RUN] Would create PR for branch: {}", branchName);
            }

            // Step 6: Post final message and update status
            currentStep = "updating_status";
            String finalMessage = "Completed: " + pickedUp.getTitle();
            if (prUrl != null) {
                finalMessage += ". PR: " + prUrl;
            }
            apiService.postMessage(pickedUp.getId(), "status", finalMessage);

            apiService.updateTicketStatus(pickedUp.getId(), "review");
            log.info("Ticket {} status updated to review", pickedUp.getId());
            currentStep = "done";

        } catch (Exception e) {
            log.error("Error processing ticket {}: {}", ticket.getId(), e.getMessage(), e);
            currentStep = "error";
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
            } finally {
                currentTicketId = null;
                currentStep = null;
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

    private String generateContent(Ticket ticket) throws IOException {
        String systemPrompt = buildSystemPrompt(ticket);
        String userMessage = "Ticket: " + ticket.getTitle() + "\n\n" + ticket.getDescription();
        return aiProvider.generateResponse(systemPrompt, userMessage);
    }

    private String buildSystemPrompt(Ticket ticket) {
        return "You are a coding agent working on the Vibecode platform. " +
            "Your job is to implement the requirements described in the ticket. " +
            "Project: " + config.getProjectId() + ". " +
            "Repository: " + config.getRepoOwner() + "/" + config.getRepoName() + ". " +
            "Use the AI provider: " + config.getAiProvider() + " with model: " + config.getAiModel() + ". " +
            "Follow best practices and write clean, maintainable code.";
    }

    private String buildPrBody(Ticket ticket, String branchName) {
        return "## Ticket\n" +
            "**Title:** " + ticket.getTitle() + "\n" +
            "**Description:** " + ticket.getDescription() + "\n\n" +
            "## Changes\n" +
            "- Branch: `" + branchName + "`\n" +
            "- Generated by Vibecode AI Agent\n\n" +
            "## Checklist\n" +
            "- [ ] Code follows project conventions\n" +
            "- [ ] Tests pass\n" +
            "- [ ] No breaking changes";
    }
}
