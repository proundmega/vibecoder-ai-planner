package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.service.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.List;

/**
 * Main entry point for the Vibecode AI Agent.
 * 
 * The agent runs in a loop:
 * 1. Poll for available backlog tickets
 * 2. Pick up and process each ticket
 * 3. Wait for the poll interval
 * 4. Repeat
 * 
 * Run with:
 *   java -jar agent.jar
 * 
 * Or with env vars:
 *   AGENT_API_KEY=xxx BACKEND_URL=http://localhost:3001 PROJECT_ID=1 \
 *   REPO_OWNER=myorg REPO_NAME=myrepo \
 *   java -jar agent.jar
 */
public class AgentApp {

    private static final Logger log = LoggerFactory.getLogger(AgentApp.class);

    private final AgentConfig config;
    private final ApiService apiService;
    private final AiProvider aiProvider;
    private final GitHubService gitHubService;
    private final TicketProcessor ticketProcessor;

    public AgentApp(AgentConfig config) {
        this.config = config;
        this.apiService = new ApiService(config);
        this.aiProvider = createAiProvider();
        this.gitHubService = new GitHubService(config.getAgentApiKey(), config.getRepoOwner(), config.getRepoName());
        this.ticketProcessor = new TicketProcessor(config, apiService, aiProvider, gitHubService);
    }

    private AiProvider createAiProvider() {
        String endpointUrl = config.getAiEndpointUrl();
        String model = config.getAiModel();
        String apiKey = config.getAiApiKey();

        if (apiKey == null || apiKey.isBlank()) {
            log.warn("No AI_API_KEY set, will try to fetch from backend credentials");
        }

        // If AI_ENDPOINT_URL is set, use OpenAI-compatible provider
        if (endpointUrl != null && !endpointUrl.isBlank()) {
            log.info("Using OpenAI-compatible provider with endpoint: {}, model: {}", endpointUrl, model);
            return new OpenAiCompatibleProvider(endpointUrl, model, apiKey);
        }

        String provider = config.getAiProvider().toLowerCase();
        switch (provider) {
            case "openai":
                log.info("Using OpenAI provider, model: {}", model);
                return new OpenAiProvider(apiKey, model);
            case "claude":
            default:
                log.info("Using Claude provider, model: {}", model);
                return new ClaudeProvider(apiKey, model);
        }
    }

    /**
     * Main entry point - starts the polling loop.
     */
    public void start() {
        log.info("Starting Vibecode AI Agent");
        log.info("Config: {}", config);
        log.info("Dry run: {}", config.isDryRun() ? "YES (no branches/PRs will be created)" : "NO");

        Runtime.getRuntime().addShutdownHook(new Thread(this::shutdown, "shutdown-hook"));

        log.info("Polling for tickets every {} ms", config.getPollInterval().toMillis());

        while (!Thread.currentThread().isInterrupted()) {
            try {
                processCycle();
            } catch (Exception e) {
                log.error("Error in processing cycle", e);
            }

            try {
                log.info("Waiting {} ms before next poll...", config.getPollInterval().toMillis());
                Thread.sleep(config.getPollInterval().toMillis());
            } catch (InterruptedException e) {
                log.info("Agent interrupted, shutting down");
                Thread.currentThread().interrupt();
                break;
            }
        }

        log.info("Agent stopped");
    }

    private void processCycle() throws IOException {
        log.info("Fetching available tickets...");
        List<Ticket> backlogTickets = apiService.listBacklogTickets();
        log.info("Found {} backlog tickets", backlogTickets.size());

        int processed = 0;
        for (Ticket ticket : backlogTickets) {
            if (processed >= config.getMaxTicketsPerCycle()) {
                log.info("Reached max tickets per cycle ({}), stopping", config.getMaxTicketsPerCycle());
                break;
            }
            if (ticket.isAvailable()) {
                ticketProcessor.processTicket(ticket);
                processed++;
            }
        }

        if (processed == 0) {
            log.info("No tickets to process this cycle");
        } else {
            log.info("Processed {} ticket(s) this cycle", processed);
        }
    }

    private void shutdown() {
        log.info("Shutting down agent...");
    }

    public static void main(String[] args) {
        try {
            AgentConfig config = new AgentConfig();
            AgentApp app = new AgentApp(config);
            app.start();
        } catch (IllegalStateException e) {
            log.error("Configuration error: {}", e.getMessage());
            System.err.println("Error: " + e.getMessage());
            System.err.println("Required env vars: AGENT_API_KEY, BACKEND_URL, PROJECT_ID, REPO_OWNER, REPO_NAME");
            System.exit(1);
        } catch (Exception e) {
            log.error("Fatal error", e);
            System.exit(1);
        }
    }
}
