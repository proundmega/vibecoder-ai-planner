package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.config.RepoCoordinates;
import com.vibecode.agent.harness.HarnessConfig;
import com.vibecode.agent.harness.RedactionRegistry;
import com.vibecode.agent.harness.HarnessTicketProcessor;
import com.vibecode.agent.harness.ProfileValidationProcessor;
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
 *   # enrolled node runtime (the supervisor also sets the runtime fields)
 *   ENROLLMENT_TOKEN=enr_xxx \
 *   BACKEND_URL=http://localhost:3001 AGENT_CREDENTIALS_FILE=/credentials/node.json \
 *   AGENT_ROLE=worker AGENT_LLM_MODEL=acme/claude-sonnet \
 *   java -jar agent.jar
 */
public class AgentApp {

    private static final Logger log = LoggerFactory.getLogger(AgentApp.class);

    private final AgentConfig config;
    private final ApiService apiService;
    private final com.vibecode.agent.service.AgentAuthManager authManager;
    private final com.vibecode.agent.service.RuntimeApi runtimeApi;
    private volatile ProviderSettings providerSettings;
    private volatile GitHubService gitHubService;
    private final GitHubTokenProvider githubTokenProvider;
    private volatile TicketWorker ticketWorker;
    private volatile ReviewProcessor reviewProcessor;
    private volatile long lastProviderRefreshAt = 0;
    /** Minimum interval between provider-config reads (audit volume). */
    private static final long MIN_PROVIDER_REFRESH_MS = 60_000L;
    private static final long DEFAULT_PROVIDER_REFRESH_MS = 300_000L;
    private final long providerRefreshIntervalMs;
    private final long providerRefreshJitterMs;
    private final ProfileValidationProcessor profileValidationProcessor;
    private ScheduledExecutorService heartbeatScheduler;
    private String githubAccessToken;
    private volatile boolean shuttingDown = false;
    private volatile boolean startupRecoveryComplete = false;
    private final java.util.concurrent.atomic.AtomicBoolean runtimeStatusReported =
        new java.util.concurrent.atomic.AtomicBoolean(false);

    public AgentApp(AgentConfig config) {
        this(config, null);
    }

    public AgentApp(AgentConfig config, AgentAuthManager authManager) {
        this(config, authManager, new ApiService(config, authManager));
    }

    AgentApp(AgentConfig config, AgentAuthManager authManager, ApiService apiService) {
        this.config = config;
        this.apiService = apiService;
        this.authManager = authManager;
        this.runtimeApi = authManager != null
            ? new com.vibecode.agent.service.RuntimeApi(config, authManager)
            : null;
        // #182 gates repository/token reads on a running runtime. Report
        // running before the constructor reads the project repository; the
        // supervisor declares the runtime as pending before spawning us.
        reportRuntimeRunningBeforeStartup();
        applyServerRepoConfig();
        this.providerSettings = resolveProviderSettings();
        this.providerRefreshIntervalMs = providerRefreshIntervalMs();
        this.providerRefreshJitterMs = providerRefreshJitterMs(config.getRuntimeId());
        // The constructor already read the provider config; do not read it
        // again on the first poll (each read is an audited event).
        this.lastProviderRefreshAt = System.currentTimeMillis();
        RedactionRegistry.register(config.getEnrollmentToken(), config.getAiApiKey(),
            providerSettings.apiKey(), System.getenv("GITHUB_TOKEN"));
        AiProvider aiProvider = createAiProvider(providerSettings);
        this.githubTokenProvider = createGitHubTokenProvider();
        // Local/SSH repositories have no bearer credential; do not call the
        // token route just to log a 400 at startup.
        boolean credentiallessRepo = "none".equals(config.getRepoAuthMode())
            || "ssh".equals(config.getRepoAuthMode());
        this.githubAccessToken = credentiallessRepo
            ? null
            : fetchGitHubToken(githubTokenProvider);
        if (githubAccessToken != null) {
            RedactionRegistry.register(githubAccessToken);
        }
        RedactionRegistry.register(githubTokenProvider.knownTokens());
        GitHubWiring wiring = createGitHubWiring(
            config, apiService, providerSettings,
            githubTokenProvider, githubAccessToken, config.getHarnessConfig());
        this.gitHubService = wiring.gitHubService();
        this.ticketWorker = wiring.ticketWorker();
        if (ticketWorker instanceof HarnessTicketProcessor harnessWorker) {
            this.profileValidationProcessor = new ProfileValidationProcessor(
                config, apiService, harnessWorker.sandboxConfig(),
                harnessWorker.sandboxRunner(), githubTokenProvider, githubAccessToken);
        } else {
            this.profileValidationProcessor = null;
        }

        HarnessConfig harnessConfig = config.getHarnessConfig();
        log.info("Harness mode: opencode (binary={}, model={})",
            harnessConfig.binary(),
            harnessConfig.modelOverride() != null
                ? harnessConfig.modelOverride()
                : providerSettings.model());

        if (supportsLegacyProvider(providerSettings)) {
            this.reviewProcessor = new ReviewProcessor(apiService, aiProvider, config.getRuntimeId());
        } else {
            this.reviewProcessor = null;
            log.warn("Review processing disabled: provider '{}' is only supported by the OpenCode harness",
                providerSettings.normalizedType());
        }
    }

    /**
     * Builds the GitHub clients from the provider object itself. The parameter
     * type is GitHubTokenProvider (not GitHubTokenSource) so a method reference
     * cannot silently drop the provider's refresh() override.
     */
    record GitHubWiring(GitHubService gitHubService, TicketWorker ticketWorker) {
    }

    static GitHubWiring createGitHubWiring(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings providerSettings,
        GitHubTokenProvider tokenProvider,
        String githubToken,
        HarnessConfig harnessConfig
    ) {
        RedactionRegistry.register(config.getEnrollmentToken(), config.getAiApiKey(),
            System.getenv("GITHUB_TOKEN"), githubToken);
        GitHubService gitHubService = null;
        GitService gitService = null;
        if (providerSettings != null) {
            RedactionRegistry.register(providerSettings.apiKey());
        }
        if (tokenProvider != null) {
            RedactionRegistry.register(tokenProvider.knownTokens());
        }
        GitCredentialProvider credentials = GitCredentialProvider.fromConfig(config);
        gitHubService = credentials.createGitHubService(tokenProvider);
        gitService = credentials.createGitService(
            gitHubService,
            new BackendReviewClient(apiService, config.getRepoProvider()));
        harnessConfig.validate();
        TicketWorker ticketWorker = new HarnessTicketProcessor(
            config, apiService, providerSettings, gitHubService,
            tokenProvider, githubToken, harnessConfig, gitService);
        return new GitHubWiring(gitHubService, ticketWorker);
    }

    private static boolean supportsLegacyProvider(ProviderSettings settings) {
        String type = settings.normalizedType();
        boolean openCode = type.equals("opencode") || type.equals("opencode-go");
        return !openCode || (settings.baseUrl() != null && !settings.baseUrl().isBlank());
    }

    private GitHubTokenProvider createGitHubTokenProvider() {
        boolean github = "github".equals(config.getRepoProvider());
        GitHubTokenSource legacyFallback = null;
        if (github && "pat".equals(config.getGitHubAuthMode()) && config.isAllowPat()) {
            legacyFallback = this::fetchLegacyPat;
        }
        return buildTokenProvider(
            config,
            force -> apiService.requestGitHubToken(
                config.getProjectId(), config.getRepoProvider(), force),
            legacyFallback);
    }

    /**
     * The deployment-wide GitHub mode only constrains GitHub; a self-hosted
     * provider's auth mode comes from the project repo config (applied before
     * this provider is built). A stored self-hosted PAT is the normal
     * credential, not the GitHub fallback, so it is always allowed.
     */
    static GitHubTokenProvider buildTokenProvider(
            AgentConfig config,
            GitHubTokenProvider.Fetcher fetcher,
            GitHubTokenSource fallback) {
        boolean github = "github".equals(config.getRepoProvider());
        String expectedMode = github
            ? config.getGitHubAuthMode()
            : config.getRepoAuthMode();
        boolean allowPat = !github || config.isAllowPat();
        return new GitHubTokenProvider(fetcher, fallback, expectedMode, allowPat);
    }

    private String fetchGitHubToken(GitHubTokenProvider provider) {
        try {
            String token = provider.get();
            log.info("Fetched GitHub credential from backend (mode={})", provider.getMode());
            return token;
        } catch (Exception e) {
            // Never log the exception message: a mapping error can include a
            // source snippet from the token response.
            log.warn("No GitHub credential available — publishing will fail closed");
        }
        return null;
    }

    private String fetchLegacyPat() {
        try {
            Map<String, Object> repoConfig = apiService.getRepoConfig(config.getProjectId());
            Object accessToken = repoConfig.get("accessToken");
            if (accessToken instanceof String) {
                String token = (String) accessToken;
                if (token != null && !token.isBlank()) {
                    log.info("Fetched GitHub PAT from backend (explicit fallback)");
                    return token;
                }
            }
        } catch (Exception e) {
            log.debug("Could not fetch GitHub PAT from the backend");
        }

        String envToken = config.getGitHubToken();
        if (envToken != null && !envToken.isBlank()) {
            log.warn("Using GITHUB_TOKEN env fallback (explicit pat mode)");
            return envToken;
        }

        log.warn("No GitHub PAT available in explicit pat mode");
        return null;
    }

    /**
     * The project's configured repository is authoritative in build mode.
     * `auto` keeps the legacy env-pair signal; `review` never builds.
     */
    private void applyServerRepoConfig() {
        if (config.isReviewMode()) {
            log.info("Runtime role {}: build ticket processing disabled, repository not loaded", config.getRole());
            return;
        }

        if (config.getProjectId() == null || config.getProjectId().isBlank()) {
            if (config.isBuildMode()) {
                throw new IllegalStateException(
                    "A worker runtime requires a project id and a configured repository");
            }
            return;
        }

        resolveRepoConfig(config, () -> apiService.getRepoConfig(config.getProjectId()));
    }

    /**
     * Fetch/apply the project repo for an already-selected mode. Package-private
     * static so build/review/failure behavior is testable without constructing
     * a live AgentApp.
     */
    static void resolveRepoConfig(
            AgentConfig config,
            java.util.concurrent.Callable<Map<String, Object>> loader) {
        if (config.isReviewMode()) return;
        boolean buildMode = config.isBuildMode();

        Map<String, Object> repo;
        try {
            repo = loader.call();
        } catch (AgentAuthFatalException e) {
            throw new IllegalStateException(
                "Agent credentials failed while loading the project repository; re-enroll this node", e);
        } catch (Exception e) {
            if (buildMode && !config.hasRepoCoordinates()) {
                throw new IllegalStateException(
                    "The worker runtime could not load the project repository: " + e.getMessage(), e);
            }
            log.warn("Could not load the project repository from the backend; using REPO_OWNER/REPO_NAME if set");
            return;
        }

        boolean applied = repo != null && applyRepoCoordinates(config, repo);
        if (!applied) {
            if (buildMode && !config.hasRepoCoordinates()) {
                throw new IllegalStateException(
                    "The worker runtime has no usable project repository configured");
            }
            log.info("No usable project repository from the backend; using REPO_OWNER/REPO_NAME if set");
        }
    }

    static boolean applyRepoCoordinates(AgentConfig config, Map<String, Object> repoConfig) {
        if (repoConfig == null) return false;
        Object url = repoConfig.get("repoUrl");
        if (url == null) return false;
        config.setRepoUrl(String.valueOf(url));
        Object provider = repoConfig.get("provider");
        if (provider instanceof String value && !value.isBlank()) {
            config.setRepoProvider(value);
        }
        Object baseUrl = repoConfig.get("providerBaseUrl");
        if (baseUrl instanceof String value && !value.isBlank()) {
            config.setRepoBaseUrl(value);
        }
        Object authMode = repoConfig.get("authMode");
        if (authMode instanceof String value && !value.isBlank()) {
            config.setRepoAuthMode(value);
        }
        Object sshKey = repoConfig.get("sshKey");
        if (sshKey instanceof String value && !value.isBlank()) {
            config.setGitSshKeyPem(value);
        }
        return RepoCoordinates.parse(String.valueOf(url)).map(coordinates -> {
            config.setRepoCoordinates(coordinates.owner(), coordinates.name());
            log.info("Using project repository {}/{} from the backend", coordinates.owner(), coordinates.name());
            return true;
        }).orElseGet(() -> {
            log.warn("Project repository URL is not a usable Git URL");
            return false;
        });
    }

    /**
     * Resolves provider settings once so the legacy path and the harness share
     * the same credentials, model and endpoint.
     */
    private ProviderSettings resolveProviderSettings() {
        ProviderSettings fromBackend = fetchProviderSettings();
        if (fromBackend != null) {
            return fromBackend;
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
        String effort = com.vibecode.agent.service.ProviderEffort.canonical(config.getEffort());
        return new ProviderSettings(type, apiKey, endpointUrl, model, config.getAiMaxTokens(), effort,
            config.getEffort() != null);
    }

    /**
     * Fetch the runtime provider config. Returns null on failure so a refresh
     * never replaces a working provider with an env fallback.
     */
    private ProviderSettings fetchProviderSettings() {
        Map<String, Object> providerConfig = null;
        try {
            providerConfig = unwrapProviderConfig(apiService.getProviderConfig());
            log.info("Fetched provider config from backend: type={}, model={}",
                providerConfig != null ? first(providerConfig, "provider_type", "providerType") : "null",
                providerConfig != null ? providerConfig.get("model") : "null");
        } catch (Exception e) {
            log.warn("Failed to fetch provider config from backend: {}", e.getMessage());
            return null;
        }

        if (providerConfig == null || first(providerConfig, "api_key", "apiKey") == null) {
            return null;
        }
        String apiKey = first(providerConfig, "api_key", "apiKey");
        String baseUrl = first(providerConfig, "base_url", "baseUrl");
        String model = providerConfig.get("model") != null
            ? String.valueOf(providerConfig.get("model"))
            : config.getAiModel();
        String providerType = first(providerConfig, "provider_type", "providerType");
        Object maxTokensRaw = providerConfig.get("max_tokens") != null
            ? providerConfig.get("max_tokens")
            : providerConfig.get("maxTokens");
        int maxTokens = maxTokensRaw instanceof Number number
            ? number.intValue()
            : config.getAiMaxTokens();
        Object effortRaw = providerConfig.get("effort");
        String effort = com.vibecode.agent.service.ProviderEffort.resolve(
            effortRaw != null ? String.valueOf(effortRaw) : null,
            config.getEffort());

        String type = providerType == null ? "claude" : providerType;
        String normalized = type.toLowerCase().replace('_', '-');
        boolean openCode = normalized.equals("opencode") || normalized.equals("opencode-go");
        if (baseUrl != null && !baseUrl.isBlank() && !openCode) {
            normalized = "generic";
        }
        return new ProviderSettings(normalized, apiKey, baseUrl, model, maxTokens, effort,
            config.getEffort() != null);
    }

    /**
     * Re-resolve the provider config at a bounded interval so a rotated key or
     * effort change is picked up without restarting the runtime. Runs between
     * tickets, where no harness client is active.
     */
    void refreshProviderSettingsIfDue() {
        long now = System.currentTimeMillis();
        if (now - lastProviderRefreshAt < providerRefreshIntervalMs + providerRefreshJitterMs) {
            return;
        }
        lastProviderRefreshAt = now;
        ProviderSettings next;
        try {
            next = fetchProviderSettings();
        } catch (RuntimeException e) {
            log.warn("Provider refresh failed: {}", e.getMessage());
            return;
        }
        if (next == null || sameProviderSettings(providerSettings, next)) {
            return;
        }
        log.info("Provider config changed; rebuilding runtime providers (type={}, model={})",
            next.normalizedType(), next.model());
        this.providerSettings = next;
        RedactionRegistry.register(next.apiKey());
        AiProvider aiProvider = createAiProvider(next);
        GitHubWiring wiring = createGitHubWiring(
            config, apiService, next,
            githubTokenProvider, githubAccessToken, config.getHarnessConfig());
        this.gitHubService = wiring.gitHubService();
        this.ticketWorker = wiring.ticketWorker();
        if (supportsLegacyProvider(next)) {
            this.reviewProcessor = new ReviewProcessor(apiService, aiProvider, config.getRuntimeId());
        } else {
            this.reviewProcessor = null;
        }
        startupRecoveryComplete = false;
    }

    static long providerRefreshIntervalMs() {
        String raw = System.getenv("PROVIDER_CONFIG_REFRESH_SECONDS");
        if (raw == null || raw.isBlank()) {
            return DEFAULT_PROVIDER_REFRESH_MS;
        }
        try {
            long seconds = Long.parseLong(raw.trim());
            return Math.max(MIN_PROVIDER_REFRESH_MS, seconds * 1000L);
        } catch (NumberFormatException e) {
            return DEFAULT_PROVIDER_REFRESH_MS;
        }
    }

    /** Spread refreshes so a large fleet does not read config in lockstep. */
    static long providerRefreshJitterMs(String runtimeId) {
        if (runtimeId == null || runtimeId.isBlank()) {
            return 0;
        }
        return Math.floorMod(runtimeId.hashCode(), 30_000);
    }

    static boolean sameProviderSettings(ProviderSettings a, ProviderSettings b) {
        if (a == null || b == null) return a == b;
        return java.util.Objects.equals(a.normalizedType(), b.normalizedType())
            && java.util.Objects.equals(a.apiKey(), b.apiKey())
            && java.util.Objects.equals(a.baseUrl(), b.baseUrl())
            && java.util.Objects.equals(a.model(), b.model())
            && a.maxTokens() == b.maxTokens()
            && java.util.Objects.equals(a.effort(), b.effort());
    }

    private AiProvider createAiProvider(ProviderSettings settings) {
        String type = settings.normalizedType();
        int maxTokens = settings.maxTokens() > 0 ? settings.maxTokens() : config.getAiMaxTokens();

        switch (type) {
            case "openai":
                log.info("Using OpenAI provider, model: {}", settings.model());
                return new OpenAiProvider(settings.apiKey(), settings.model(), settings.effort(), settings.effortExplicit());
            case "generic":
                log.info("Using OpenAI-compatible provider: {}, model: {}",
                    settings.baseUrl(), settings.model());
                return new OpenAiCompatibleProvider(
                    settings.baseUrl(), settings.model(), settings.apiKey(), maxTokens,
                    settings.effort(), settings.effortExplicit());
            case "opencode":
            case "opencode-go":
                if (settings.baseUrl() != null && !settings.baseUrl().isBlank()) {
                    log.info("Using OpenAI-compatible OpenCode endpoint: {}, model: {}",
                        settings.baseUrl(), settings.model());
                    return new OpenAiCompatibleProvider(
                        settings.baseUrl(), settings.model(), settings.apiKey(), maxTokens,
                        settings.effort(), settings.effortExplicit());
                }
                log.warn("Provider '{}' is supported by the OpenCode harness; legacy provider disabled",
                    type);
                return new ClaudeProvider(settings.apiKey(), settings.model(), settings.effort(), settings.effortExplicit());
            case "claude":
            case "anthropic":
            default:
                log.info("Using Claude provider, model: {}", settings.model());
                return new ClaudeProvider(settings.apiKey(), settings.model(), settings.effort(), settings.effortExplicit());
        }
    }

    /**
     * Defensive unwrap for provider config responses.
     * Handles both flat (fixed backend) and double-wrapped (buggy backend) response formats.
     */
    private static String first(Map<String, Object> map, String... keys) {
        for (String key : keys) {
            Object value = map.get(key);
            if (value != null && !String.valueOf(value).isBlank()) {
                return String.valueOf(value);
            }
        }
        return null;
    }

    private static Map<String, Object> unwrapProviderConfig(Map<String, Object> raw) {
        if (raw == null) return null;
        if (raw.get("provider") instanceof Map) {
            return (Map<String, Object>) raw.get("provider");
        }
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

        // Reconcile runs left active by a previous process before polling. A
        // published run keeps its reviewed ticket; anything else is failed and
        // returned only through the backend's guarded release path.
        recoverStartupOnce();

        heartbeatScheduler = Executors.newScheduledThreadPool(1, runnable -> {
            Thread thread = new Thread(runnable, "agent-heartbeat");
            thread.setDaemon(true);
            return thread;
        });
        heartbeatScheduler.scheduleAtFixedRate(this::heartbeatTick, 30, 30, TimeUnit.SECONDS);
        // A child without a runtime id resolved at construction reports
        // `running` here, after the supervisor's declaration succeeds.
        if (!runtimeStatusReported.get()) {
            heartbeatTick();
        }

        log.info("Polling for tickets every {} ms", config.getPollInterval().toMillis());

        while (!Thread.currentThread().isInterrupted()) {
            try {
                processCycle();
            } catch (AgentAuthFatalException e) {
                exitOnFatalAuth(e);
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
    /**
     * One heartbeat tick. The first successful send reports {@code running};
     * later sends omit the status so an admin drain/stop is preserved. A
     * failed first send is retried on the next tick.
     */
    void heartbeatTick() {
        try {
            Map<String, Object> mem = new HashMap<>();
            mem.put("free", Runtime.getRuntime().freeMemory());
            mem.put("total", Runtime.getRuntime().totalMemory());
            mem.put("max", Runtime.getRuntime().maxMemory());

            Map<String, Object> cpu = new HashMap<>();
            cpu.put("availableProcessors", Runtime.getRuntime().availableProcessors());

            if ((config.getRuntimeId() == null || config.getRuntimeId().isBlank())
                    && runtimeApi != null) {
                // A child may start before the supervisor's declaration
                // succeeds. Retry on the heartbeat tick rather than
                // exiting into a restart loop.
                resolveRuntimeIdentity(config, runtimeApi);
            }
            if (config.getRuntimeId() == null || config.getRuntimeId().isBlank()) {
                log.debug("Skipping heartbeat: runtime id is not resolved yet");
                return;
            }
            // Report running once. Later heartbeats send no status so an
            // admin drain/stop is not overwritten by COALESCE($3, status).
            boolean firstHeartbeat = !runtimeStatusReported.get();
            apiService.sendHeartbeat(
                config.getRuntimeId(),
                firstHeartbeat ? "running" : null,
                config.getProjectId()
            );
            if (firstHeartbeat) {
                runtimeStatusReported.set(true);
            }
        } catch (AgentAuthFatalException e) {
            exitOnFatalAuth(e);
        } catch (com.vibecode.agent.service.ApiService.RuntimeRevokedException e) {
            log.error("Runtime is no longer authorized: {}", e.getMessage());
            releaseCurrentClaim();
            writeStopMarker();
            shuttingDown = true;
            shutdown();
            System.exit(0);
        } catch (Exception e) {
            log.warn("Heartbeat send failed", e);
        }
    }

    /**
     * Report {@code running} before constructor wiring. #182 requires a live
     * runtime for the project repository/token reads, and the supervisor
     * creates the row as {@code pending}.
     */
    private void reportRuntimeRunningBeforeStartup() {
        if (config.getRuntimeId() == null || config.getRuntimeId().isBlank()) {
            return;
        }
        try {
            apiService.sendHeartbeat(config.getRuntimeId(), "running", config.getProjectId());
            runtimeStatusReported.set(true);
        } catch (Exception e) {
            log.warn("Could not report the runtime running before startup: {}", e.getMessage());
        }
    }

    /**
     * Retry startup recovery on each poll until the active-run listing
     * succeeds. The backend reaper still reconciles terminal runs, so a failed
     * listing delays recovery rather than losing it.
     */
    private void recoverStartupOnce() {
        if (startupRecoveryComplete) {
            return;
        }
        if (config.getRuntimeConcurrency() > 1) {
            // Several children share one runtime id. Recovery lists runs by
            // runtime id, so a sibling would see and reconcile another child's
            // active run. Let the run reaper own shared-runtime recovery.
            log.info("Skipping per-child harness recovery: runtime concurrency is {}",
                config.getRuntimeConcurrency());
            startupRecoveryComplete = true;
            return;
        }
        if (!(ticketWorker instanceof HarnessTicketProcessor harnessWorker)) {
            startupRecoveryComplete = true;
            return;
        }
        try {
            int recovered = harnessWorker.recoverActiveRuns();
            if (recovered < 0) {
                log.warn("Harness startup recovery could not list active runs; "
                    + "will retry on the next cycle");
                return;
            }
            if (harnessWorker.isRecoveryDeferred()) {
                log.info("Harness startup recovery skipped fresh run(s); "
                    + "will retry on the next cycle");
                return;
            }
            startupRecoveryComplete = true;
            log.info("Harness startup recovery reconciled {} run(s)", recovered);
            // Cleanup is only safe after the active-run listing succeeded; the
            // processor also fails closed if it cannot fetch protected paths.
            harnessWorker.pruneStaleWorkspaces();
        } catch (RuntimeException e) {
            log.warn("Harness startup recovery failed; will retry: {}", e.getMessage());
        }
    }

    private void processCycle() throws IOException {
        refreshProviderSettingsIfDue();
        recoverStartupOnce();

        if (config.isPlanner()) {
            // Planning runtimes use the guarded planning API; the build loop
            // never runs here. The planner claim path is exposed in the joint
            // fg-40/fg-54 integration.
            log.info("Planner runtime is idle: build and review cycles are disabled");
            pollProfileValidation();
            return;
        }
        if (config.isReviewer()) {
            log.info("Reviewer runtime {}: build ticket processing is disabled", config.getRuntimeId());
            if (reviewProcessor == null) {
                log.warn("Review cycle skipped: the configured provider is not usable by the legacy review path");
                pollProfileValidation();
                return;
            }
            reviewProcessor.processReviewCycle();
            pollProfileValidation();
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

        // Dry runs run after ticket work so a long profile validation cannot
        // starve the build queue in the same poll cycle.
        pollProfileValidation();
    }

    private void pollProfileValidation() {
        if (profileValidationProcessor == null) {
            return;
        }
        try {
            profileValidationProcessor.pollOnce();
        } catch (RuntimeException e) {
            log.warn("Repo profile validation cycle failed: {}", e.getMessage());
        }
    }

    static volatile java.util.function.IntConsumer exitHook = System::exit;

    /**
     * A child started before the supervisor declared its runtimes resolves its
     * own id/role/model from the node config. The server is authoritative; the
     * child still cannot assert a role.
     */
    static void resolveRuntimeIdentity(AgentConfig config, com.vibecode.agent.service.RuntimeApi api) {
        String wanted = System.getenv("AGENT_RUNTIME_NAME");
        for (int attempt = 1; attempt <= 5; attempt++) {
            try {
                Map<String, Object> nodeConfig = api.fetchConfig();
                Map<String, Object> match = findRuntime(nodeConfig, wanted);
                if (match != null && match.get("id") != null) {
                    config.setRuntimeIdentity(
                        String.valueOf(match.get("id")),
                        string(match.get("role")),
                        string(match.get("modelRef") != null ? match.get("modelRef") : match.get("model_ref")),
                        string(match.get("effort")));
                    log.info("Resolved runtime identity from node config (runtimeId={}, role={})",
                        config.getRuntimeId(), config.getRole());
                    if (config.isBuildMode()
                        && (config.getProjectId() == null || config.getProjectId().isBlank())) {
                        log.warn("Worker runtime has no project hint; set project in agent.ini "
                            + "or AGENT_PROJECT_ID until the runtime claim API lands");
                    }
                    return;
                }
            } catch (Exception e) {
                log.warn("Could not resolve runtime identity (attempt {}/5): {}", attempt, e.getMessage());
            }
            if (attempt < 5) {
                try {
                    Thread.sleep(2000L * attempt);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        log.error("Runtime identity is unresolved; the supervisor must declare this runtime");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> findRuntime(Map<String, Object> nodeConfig, String wanted) {
        if (nodeConfig == null || wanted == null) return null;
        Object runtimes = nodeConfig.get("runtimes");
        if (runtimes == null) runtimes = nodeConfig.get("data");
        if (runtimes instanceof Map<?, ?> map) runtimes = map.get("runtimes");
        if (!(runtimes instanceof List<?> list)) return null;
        for (Object item : list) {
            if (item instanceof Map<?, ?> row) {
                Map<String, Object> runtime = (Map<String, Object>) row;
                String name = string(runtime.get("name"));
                if (name != null && (wanted.equals(name) || name.startsWith(wanted + "-"))) {
                    return runtime;
                }
            }
        }
        return null;
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    static void exitOnFatalAuth(AgentAuthFatalException error) {
        log.error("Agent authentication failed: {}", error.getMessage());
        System.err.println("Error: " + RedactionRegistry.redact(error.getMessage()));
        exitHook.accept(1);
    }

    private void releaseCurrentClaim() {
        try {
            String ticketId = ticketWorker == null ? null : ticketWorker.getCurrentTicketId();
            if (ticketId != null && !ticketId.isBlank()) {
                apiService.releaseTicket(Long.valueOf(ticketId));
                log.info("Released claim for ticket {} after runtime revocation", ticketId);
            }
        } catch (Exception releaseError) {
            // The revocation may also deny the release; the reaper owns the
            // final cleanup. Never loop here.
            log.warn("Could not release the claim after revocation: {}", releaseError.getMessage());
        }
    }

    private void writeStopMarker() {
        String path = config.getRuntimeStopFile();
        if (path == null || path.isBlank()) {
            return;
        }
        try {
            java.nio.file.Path marker = java.nio.file.Path.of(path);
            if (marker.getParent() != null) {
                java.nio.file.Files.createDirectories(marker.getParent());
            }
            java.nio.file.Files.writeString(marker, "revoked");
        } catch (Exception e) {
            log.warn("Could not write the runtime stop marker: {}", e.getMessage());
        }
    }

    private void shutdown() {
        log.info("Shutting down agent...");
        if (heartbeatScheduler != null) {
            if (Thread.currentThread().getName().startsWith("agent-heartbeat")) {
                // Called from the heartbeat task; do not await our own pool.
                heartbeatScheduler.shutdownNow();
                return;
            }
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
            AgentAuthManager authManager = null;
            String supervisorConfig = System.getenv("SUPERVISOR_CONFIG");
            if (supervisorConfig != null && !supervisorConfig.isBlank()) {
                com.vibecode.agent.supervisor.SupervisorMain.run(supervisorConfig);
                return;
            }
            AgentCredentialStore store = new AgentCredentialStore(
                java.nio.file.Path.of(config.getCredentialsFile()));
            authManager = new AgentAuthManager(config, store, new AgentEnrollmentClient(config));
            authManager.initialize();
            log.info("Node authenticated via enrollment (nodeId={})", config.getNodeId());
            if (config.getRuntimeId() == null || config.getRuntimeId().isBlank()) {
                resolveRuntimeIdentity(config, new com.vibecode.agent.service.RuntimeApi(config, authManager));
            }
            AgentApp app = new AgentApp(config, authManager);
            app.start();
        } catch (IllegalStateException e) {
            log.error("Configuration error: {}", e.getMessage());
            System.err.println("Error: " + RedactionRegistry.redact(e.getMessage()));
            System.err.println("Required env vars: BACKEND_URL, AGENT_CREDENTIALS_FILE "
                + "and ENROLLMENT_TOKEN (first boot only)");
            System.err.println("The supervisor sets AGENT_ROLE, AGENT_RUNTIME_ID and AGENT_LLM_MODEL");
            System.exit(1);
        } catch (Exception e) {
            log.error("Fatal error", e);
            System.exit(1);
        }
    }
}
