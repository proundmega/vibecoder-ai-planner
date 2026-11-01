package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.harness.HarnessConfig;
import com.vibecode.agent.harness.HarnessTicketProcessor;
import com.vibecode.agent.harness.ProviderSettings;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.service.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

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
    private final ProviderSettings providerSettings;
    private final GitHubService gitHubService;
    private final TicketWorker ticketWorker;
    private final ReviewProcessor reviewProcessor;
    private ScheduledExecutorService heartbeatScheduler;
    private String githubAccessToken;
    private volatile boolean shuttingDown = false;

    public AgentApp(AgentConfig config) {
        this.config = config;
        this.apiService = new ApiService(config);
        this.providerSettings = resolveProviderSettings();
        AiProvider aiProvider = createAiProvider(providerSettings);
        this.githubAccessToken = fetchGitHubToken();
        this.gitHubService = new GitHubService(githubAccessToken, config.getRepoOwner(), config.getRepoName());

        HarnessConfig harnessConfig = config.getHarnessConfig();
        if (harnessConfig.isEnabled()) {
            harnessConfig.validate();
            this.ticketWorker = new HarnessTicketProcessor(
                config, apiService, providerSettings, gitHubService,
                githubAccessToken, harnessConfig);
            log.info("Harness mode: opencode (binary={}, model={})",
                harnessConfig.binary(),
                harnessConfig.modelOverride() != null
                    ? harnessConfig.modelOverride()
                    : providerSettings.model());
        } else {
            this.ticketWorker = new TicketProcessor(
                config, apiService, aiProvider, gitHubService, githubAccessToken);
            log.info("Harness mode: legacy");
        }

        if (supportsLegacyProvider(providerSettings)) {
            this.reviewProcessor = new ReviewProcessor(apiService, aiProvider, config.getAgentId());
        } else {
            this.reviewProcessor = null;
            log.warn("Review processing disabled: provider '{}' is only supported by the OpenCode harness",
                providerSettings.normalizedType());
        }
    }

    private static boolean supportsLegacyProvider(ProviderSettings settings) {
        String type = settings.normalizedType();
        boolean openCode = type.equals("opencode") || type.equals("opencode-go");
        return !openCode || (settings.baseUrl() != null && !settings.baseUrl().isBlank());
    }

    private String fetchGitHubToken() {
        // Priority 1: Backend API (decrypted PAT from project_repos)
        try {
            Map<String, Object> repoConfig = apiService.getRepoConfig(config.getProjectId());
            Object accessToken = repoConfig.get("accessToken");
            if (accessToken instanceof String) {
                String token = (String) accessToken;
                if (token != null && !token.isBlank()) {
                    log.info("Fetched GitHub PAT from backend");
                    return token;
                }
            }
        } catch (Exception e) {
            log.debug("Could not fetch GitHub PAT from backend: {}", e.getMessage());
        }

        // Priority 2: GITHUB_TOKEN env var
        String envToken = config.getGitHubToken();
        if (envToken != null && !envToken.isBlank()) {
            log.info("Using GitHub token from GITHUB_TOKEN env var");
            return envToken;
        }

        // Priority 3: Fallback to agent API key (will fail for GitHub, but preserves existing behavior)
        log.warn("No GitHub PAT available — agent GitHub operations will fail for private repos");
        return config.getAgentApiKey();
    }

    /**
     * Resolves provider settings once so the legacy path and the harness share
     * the same credentials, model and endpoint.
     */
    private ProviderSettings resolveProviderSettings() {
        Map<String, Object> providerConfig = null;
        try {
            Map<String, Object> rawConfig = apiService.getProviderConfig(config.getAgentId());
            providerConfig = unwrapProviderConfig(rawConfig);
            log.info("Fetched provider config from backend: type={}, model={}",
                providerConfig != null ? providerConfig.get("provider_type") : "null",
                providerConfig != null ? providerConfig.get("model") : "null");
        } catch (Exception e) {
            log.warn("Failed to fetch provider config from backend, falling back to env vars: {}", e.getMessage());
        }

        if (providerConfig != null && providerConfig.get("api_key") != null) {
            String apiKey = (String) providerConfig.get("api_key");
            String baseUrl = (String) providerConfig.get("base_url");
            String model = (String) providerConfig.get("model");
            String providerType = (String) providerConfig.get("provider_type");
            Object maxTokensRaw = providerConfig.get("max_tokens");
            int maxTokens = maxTokensRaw instanceof Number number
                ? number.intValue()
                : config.getAiMaxTokens();

            String type = providerType == null ? "claude" : providerType;
            String normalized = type.toLowerCase().replace('_', '-');
            boolean openCode = normalized.equals("opencode") || normalized.equals("opencode-go");
            if (baseUrl != null && !baseUrl.isBlank() && !openCode) {
                normalized = "generic";
            }
            return new ProviderSettings(normalized, apiKey, baseUrl, model, maxTokens);
        }

        // Fall back to env vars
        String endpointUrl = config.getAiEndpointUrl();
        String model = config.getAiModel();
        String apiKey = config.getAiApiKey();

        if (apiKey == null || apiKey.isBlank()) {
            log.warn("No AI_API_KEY set (from env or backend), agent may not function");
        }

        String type = endpointUrl != null && !endpointUrl.isBlank()
            ? "generic"
            : config.getAiProvider().toLowerCase();
        return new ProviderSettings(type, apiKey, endpointUrl, model, config.getAiMaxTokens());
    }

    private AiProvider createAiProvider(ProviderSettings settings) {
        String type = settings.normalizedType();
        int maxTokens = settings.maxTokens() > 0 ? settings.maxTokens() : config.getAiMaxTokens();

        switch (type) {
            case "openai":
                log.info("Using OpenAI provider, model: {}", settings.model());
                return new OpenAiProvider(settings.apiKey(), settings.model());
            case "generic":
                log.info("Using OpenAI-compatible provider: {}, model: {}",
                    settings.baseUrl(), settings.model());
                return new OpenAiCompatibleProvider(
                    settings.baseUrl(), settings.model(), settings.apiKey(), maxTokens);
            case "opencode":
            case "opencode-go":
                if (settings.baseUrl() != null && !settings.baseUrl().isBlank()) {
                    log.info("Using OpenAI-compatible OpenCode endpoint: {}, model: {}",
                        settings.baseUrl(), settings.model());
                    return new OpenAiCompatibleProvider(
                        settings.baseUrl(), settings.model(), settings.apiKey(), maxTokens);
                }
                log.warn("Provider '{}' is supported by the OpenCode harness; legacy provider disabled",
                    type);
                return new ClaudeProvider(settings.apiKey(), settings.model());
            case "claude":
            case "anthropic":
            default:
                log.info("Using Claude provider, model: {}", settings.model());
                return new ClaudeProvider(settings.apiKey(), settings.model());
        }
    }

    /**
     * Defensive unwrap for provider config responses.
     * Handles both flat (fixed backend) and double-wrapped (buggy backend) response formats.
     */
    private static Map<String, Object> unwrapProviderConfig(Map<String, Object> raw) {
        if (raw == null) return null;
        if (raw.containsKey("success") && raw.containsKey("data") && raw.get("data") instanceof Map) {
            Map<String, Object> inner = (Map<String, Object>) raw.get("data");
            if (inner.containsKey("success") && inner.containsKey("data") && inner.get("data") instanceof Map) {
                // Double-wrapped — unwrap once (buggy backend)
                return (Map<String, Object>) inner.get("data");
            }
            // Already flat — good (backend fixed)
            return inner;
        }
        return raw;
    }

    /**
     * Main entry point - starts the polling loop.
     */
    public void start() {
        log.info("Starting Vibecode AI Agent");
        log.info("Config: {}", config);
        log.info("Dry run: {}", config.isDryRun() ? "YES (no branches/PRs will be created)" : "NO");

        Runtime.getRuntime().addShutdownHook(new Thread(this::shutdown, "shutdown-hook"));

        try {
            Class<?> signalClass = Class.forName("sun.misc.Signal");
            Object signal = signalClass.getMethod("lookup", String.class).invoke(null, "INT");
            signalClass.getMethod("handle", signalClass, 
                Class.forName("sun.misc.SignalHandler")).invoke(null, signal,
                new sun.misc.SignalHandler() {
                    @Override
                    public void handle(sun.misc.Signal signal) {
                        log.info("Received SIGINT (Ctrl-C), initiating graceful shutdown...");
                        shuttingDown = true;
                        shutdown();
                        System.exit(0);
                    }
                });
            log.info("SIGINT handler registered for graceful shutdown");
        } catch (Exception e) {
            log.warn("Could not register SIGINT handler: {}", e.getMessage());
        }

        heartbeatScheduler = Executors.newScheduledThreadPool(1);
        heartbeatScheduler.scheduleAtFixedRate(() -> {
            try {
                Map<String, Object> mem = new HashMap<>();
                mem.put("free", Runtime.getRuntime().freeMemory());
                mem.put("total", Runtime.getRuntime().totalMemory());
                mem.put("max", Runtime.getRuntime().maxMemory());

                Map<String, Object> cpu = new HashMap<>();
                cpu.put("availableProcessors", Runtime.getRuntime().availableProcessors());

                apiService.sendHeartbeat(
                    config.getAgentId(),
                    ticketWorker.getCurrentTicketId(),
                    ticketWorker.getCurrentStep(),
                    mem,
                    cpu
                );
            } catch (Exception e) {
                log.warn("Heartbeat send failed", e);
            }
        }, 0, 30, TimeUnit.SECONDS);

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
        // Check if this is a review agent (no REPO_OWNER/REPO_NAME means review mode)
        if (config.getRepoOwner() == null || config.getRepoOwner().isBlank()) {
            log.warn("REPO_OWNER is not set — running in review mode only. Ticket processing is disabled. Set REPO_OWNER and REPO_NAME to enable build mode.");
            if (reviewProcessor == null) {
                log.warn("Review cycle skipped: the configured provider is not usable by the legacy review path");
                return;
            }
            reviewProcessor.processReviewCycle();
            return;
        }
        
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
                ticketWorker.processTicket(ticket);
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
        if (heartbeatScheduler != null) {
            heartbeatScheduler.shutdown();
            try {
                heartbeatScheduler.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public String getGitHubAccessToken() {
        return githubAccessToken;
    }

    public static void main(String[] args) {
        try {
            AgentConfig config = new AgentConfig();
            AgentApp app = new AgentApp(config);
            app.start();
        } catch (IllegalStateException e) {
            log.error("Configuration error: {}", e.getMessage());
            System.err.println("Error: " + e.getMessage());
            System.err.println("Required env vars: AGENT_API_KEY, BACKEND_URL, PROJECT_ID");
            System.err.println("For ticket processing: also set REPO_OWNER, REPO_NAME");
            System.err.println("For review mode: omit REPO_OWNER/REPO_NAME");
            System.exit(1);
        } catch (Exception e) {
            log.error("Fatal error", e);
            System.exit(1);
        }
    }
}
