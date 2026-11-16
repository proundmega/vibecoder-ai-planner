package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubService;
import com.vibecode.agent.service.GitHubTokenSource;
import com.vibecode.agent.service.TicketWorker;
import com.vibecode.agent.service.WorkspaceManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Supervisor for harness-driven ticket processing.
 *
 * <p>The OpenCode session owns the implementation; this class owns the ticket
 * lifecycle, verification, publishing and cleanup. Agents never commit, push or
 * open pull requests themselves.</p>
 */
public final class HarnessTicketProcessor implements TicketWorker {

    /** Creates the harness client, optionally wired to the sandbox bash bridge. */
    @FunctionalInterface
    interface HarnessClientFactory {
        HarnessClient create(
            Path tempDir,
            SandboxBashBridge bridge,
            HarnessConfig effectiveConfig
        ) throws IOException;
    }

    private static final Logger log = LoggerFactory.getLogger(HarnessTicketProcessor.class);
    private static final int MAX_MESSAGE_CHARS = 8_192;
    private static final Duration VERIFICATION_TIMEOUT = Duration.ofMinutes(10);
    private static final Duration INSTALL_TIMEOUT = Duration.ofMinutes(10);
    private static final Duration CLONE_TIMEOUT = Duration.ofMinutes(5);
    private static final int DEFAULT_MAX_ATTEMPTS = 3;
    private static final long DEFAULT_RETRY_BASE_DELAY_MS = 60_000L;
    private static final long DEFAULT_RETRY_MAX_DELAY_MS = 60L * 60_000L;

    private final AgentConfig config;
    private final ApiService apiService;
    private final ProviderSettings provider;
    private final GitHubService gitHubService;
    private final String githubToken;
    private final HarnessConfig harnessConfig;
    private final SandboxConfig sandboxConfig;
    private final SandboxRunner sandboxRunner;
    private final Function<String, WorkspaceManager> workspaceFactory;
    private final HarnessClientFactory harnessFactory;
    private final PlanningDocFetcher planningDocFetcher;
    private final RepoProfileSource repoProfileSource;
    private final VerificationRunner verificationRunner;
    private final PublishingGuard publishingGuard;
    private final SecretLeakGuard secretLeakGuard;
    private final SecretRedactor redactor;
    private final PromptBuilder promptBuilder = new PromptBuilder();
    private final Map<Long, FailureState> failures = new ConcurrentHashMap<>();
    private final HarnessEventSink eventSink;
    private final ProviderHealth providerHealth = new ProviderHealth();
    private final ModelRouter modelRouter = new ModelRouter(providerHealth);
    private final int maxAttempts = intEnv(
        "HARNESS_RETRY_PIN_ATTEMPTS",
        intEnv("HARNESS_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS));
    private final long retryBaseDelayMs = longEnv("HARNESS_RETRY_BASE_DELAY_MS", DEFAULT_RETRY_BASE_DELAY_MS);
    private final long retryMaxDelayMs = longEnv("HARNESS_RETRY_MAX_DELAY_MS", DEFAULT_RETRY_MAX_DELAY_MS);
    private final int leaseTtlSeconds = Math.min(
        86_400, Math.max(60, intEnv("HARNESS_LEASE_SECONDS", 600)));
    private final long heartbeatSeconds = Math.max(
        1, Math.min(leaseTtlSeconds / 2, longEnv("HARNESS_HEARTBEAT_SECONDS", 30)));
    private final boolean durabilityRequired =
        booleanEnv("HARNESS_DURABILITY_REQUIRED", false);
    private final long workspaceRetentionHours =
        longEnv("HARNESS_WORKSPACE_RETENTION_HOURS", 24);

    private volatile String currentTicketId;
    private volatile String currentStep;
    private volatile String startFailureReason;
    private volatile boolean recoveryDeferred;
    private volatile String currentRunId;
    private volatile boolean leaseLost;
    private volatile boolean published;
    private volatile String publishedHeadSha;
    private volatile String publishedPrUrl;
    private volatile ScheduledExecutorService heartbeatExecutor;
    private volatile String pendingTerminalStatus;
    private volatile String pendingTerminalMessage;
    private volatile String pendingHeadSha;
    private volatile String pendingPrUrl;
    private volatile boolean releaseAfterTerminalFinish;

    private volatile HarnessEventContext eventContext;
    private volatile HarnessBudgetTracker budgetTracker;
    private volatile HarnessBudgetPolicy budgetPolicy;
    private volatile ModelRouter.RoutingDecision routingDecision;
    private volatile HarnessConfig activeHarnessConfig;
    private volatile HarnessClient activeHarness;
    private volatile ScheduledExecutorService budgetExecutor;
    private volatile boolean budgetBreached;
    private volatile boolean terminalEventEmitted;
    private volatile Instant runStartedAt;
    private volatile long lastUsageReportAt;

    public HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        String githubToken
    ) {
        this(config, apiService, provider, gitHubService, githubToken, config.getHarnessConfig());
    }

    public HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        String githubToken,
        HarnessConfig harnessConfig
    ) {
        this(config, apiService, provider, gitHubService, () -> githubToken, githubToken, harnessConfig);
    }

    public HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        GitHubTokenSource tokenSource,
        String githubToken,
        HarnessConfig harnessConfig
    ) {
        this(
            config,
            apiService,
            provider,
            gitHubService,
            githubToken,
            harnessConfig,
            repoName -> new WorkspaceManager(
                config.getRepoCloneDir(), repoName, config.isDryRun(), githubToken, tokenSource),
            (tempDir, bridge, effectiveConfig) ->
                new OpenCodeClient(effectiveConfig, provider, tempDir, bridge),
            new PlanningDocFetcher(apiService, config),
            new VerificationRunner(harnessConfig),
            new PublishingGuard(harnessConfig.protectedPaths()),
            config.getSandboxConfig() == null
                ? SandboxConfig.defaults()
                : config.getSandboxConfig(),
            SandboxRunnerFactory.create(config.getSandboxConfig() == null
                ? SandboxConfig.defaults()
                : config.getSandboxConfig())
        );
    }

    HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        String githubToken,
        HarnessConfig harnessConfig,
        Function<String, WorkspaceManager> workspaceFactory,
        HarnessClientFactory harnessFactory,
        PlanningDocFetcher planningDocFetcher,
        VerificationRunner verificationRunner,
        PublishingGuard publishingGuard
    ) {
        this(
            config,
            apiService,
            provider,
            gitHubService,
            githubToken,
            harnessConfig,
            workspaceFactory,
            harnessFactory,
            planningDocFetcher,
            verificationRunner,
            publishingGuard,
            SandboxConfig.defaults(),
            SandboxRunnerFactory.hostOnly()
        );
    }

    HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        String githubToken,
        HarnessConfig harnessConfig,
        Function<String, WorkspaceManager> workspaceFactory,
        HarnessClientFactory harnessFactory,
        PlanningDocFetcher planningDocFetcher,
        VerificationRunner verificationRunner,
        PublishingGuard publishingGuard,
        SandboxConfig sandboxConfig,
        SandboxRunner sandboxRunner
    ) {
        this(
            config,
            apiService,
            provider,
            gitHubService,
            githubToken,
            harnessConfig,
            workspaceFactory,
            harnessFactory,
            planningDocFetcher,
            new RepoProfileFetcher(apiService, config),
            verificationRunner,
            publishingGuard,
            sandboxConfig,
            sandboxRunner
        );
    }

    HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        String githubToken,
        HarnessConfig harnessConfig,
        Function<String, WorkspaceManager> workspaceFactory,
        HarnessClientFactory harnessFactory,
        PlanningDocFetcher planningDocFetcher,
        RepoProfileSource repoProfileSource,
        VerificationRunner verificationRunner,
        PublishingGuard publishingGuard,
        SandboxConfig sandboxConfig,
        SandboxRunner sandboxRunner
    ) {
        this.config = config;
        this.apiService = apiService;
        this.provider = provider;
        this.gitHubService = gitHubService;
        this.githubToken = githubToken;
        this.harnessConfig = harnessConfig;
        this.sandboxConfig = sandboxConfig == null ? SandboxConfig.defaults() : sandboxConfig;
        this.sandboxRunner = sandboxRunner == null ? SandboxRunnerFactory.hostOnly() : sandboxRunner;
        this.workspaceFactory = workspaceFactory;
        this.harnessFactory = harnessFactory != null
            ? harnessFactory
            : (tempDir, bridge, effectiveConfig) -> new OpenCodeClient(
                effectiveConfig, provider, tempDir, bridge);
        this.planningDocFetcher = planningDocFetcher;
        this.repoProfileSource = repoProfileSource == null
            ? () -> null
            : repoProfileSource;
        this.verificationRunner = verificationRunner;
        this.publishingGuard = publishingGuard;
        this.secretLeakGuard = new SecretLeakGuard(knownSecrets(provider, githubToken));
        this.redactor = new SecretRedactor(redactionSecrets(provider, githubToken));
        this.eventSink = new HttpHarnessEventSink(apiService);
    }

    private HarnessConfig activeHarnessConfig() {
        HarnessConfig active = activeHarnessConfig;
        return active == null ? harnessConfig : active;
    }

    public SandboxConfig sandboxConfig() {
        return sandboxConfig;
    }

    public SandboxRunner sandboxRunner() {
        return sandboxRunner;
    }

    private static List<String> knownSecrets(ProviderSettings provider, String githubToken) {
        List<String> secrets = new ArrayList<>();
        if (provider != null) {
            secrets.add(provider.apiKey());
        }
        secrets.add(githubToken);
        return secrets;
    }

    /**
     * Every value the supervisor must keep out of persisted output: the
     * configured provider/GitHub secrets plus environment-supplied ones.
     */
    private static List<String> redactionSecrets(ProviderSettings provider, String githubToken) {
        List<String> secrets = new ArrayList<>(knownSecrets(provider, githubToken));
        secrets.add(System.getenv("AI_API_KEY"));
        secrets.add(System.getenv("GITHUB_TOKEN"));
        secrets.add(System.getenv("AGENT_API_KEY"));
        return secrets;
    }

    @Override
    public String getCurrentTicketId() {
        return currentTicketId;
    }

    @Override
    public String getCurrentStep() {
        return currentStep;
    }

    /**
     * Best-effort cleanup of clone directories older than the retention window.
     * Disabled by HARNESS_WORKSPACE_RETENTION_HOURS=0.
     */
    public int pruneStaleWorkspaces() {
        if (config.isDryRun() || workspaceRetentionHours <= 0) {
            return 0;
        }
        Long agentId = longValue(config.getAgentId());
        if (agentId == null) {
            log.warn("Skipping workspace prune: AGENT_ID is not numeric");
            return 0;
        }

        List<String> protectedPaths;
        try {
            protectedPaths = apiService.listActiveWorkspacePaths(agentId);
        } catch (IOException | RuntimeException e) {
            // Fail closed: without the active-run/lease list we cannot prove a
            // directory is safe to delete.
            log.warn("Skipping workspace prune: active workspaces unavailable: {}",
                e.getMessage());
            return 0;
        }
        if (protectedPaths == null) {
            return 0;
        }

        try {
            WorkspaceManager manager = workspaceFactory.apply(config.getRepoName());
            int removed = manager.pruneStaleWorkspaces(
                Duration.ofHours(workspaceRetentionHours), protectedPaths);
            removed += manager.pruneStaleTempDirectories(
                Duration.ofHours(workspaceRetentionHours));
            return removed;
        } catch (IOException | RuntimeException e) {
            log.warn("Could not prune stale workspaces: {}", e.getMessage());
            return 0;
        }
    }

    /**
     * Reconcile runs left active by a previous agent process.
     *
     * <p>A run with durable publish evidence (a PR URL, or a head sha plus an
     * existing PR) is adopted as succeeded so the reviewed ticket is preserved.
     * Everything else is failed and its ticket is released through the guarded
     * backend path, which refuses reviewed tickets and tickets with a PR.</p>
     *
     * @return the number of runs reconciled
     */
    public int recoverActiveRuns() {
        recoveryDeferred = false;
        if (config.isDryRun()) {
            return 0;
        }
        Long agentId = longValue(config.getAgentId());
        if (agentId == null) {
            log.warn("Cannot recover harness runs: AGENT_ID is not numeric");
            return 0;
        }

        List<Map<String, Object>> runs;
        try {
            runs = apiService.listActiveHarnessRuns(agentId);
        } catch (IOException | RuntimeException e) {
            log.warn("Could not list active harness runs for startup recovery: {}", e.getMessage());
            // Retry from the next poll cycle; the backend reaper still owns
            // terminal-run reconciliation, so nothing is released unsafely.
            return -1;
        }

        int recovered = 0;
        for (Map<String, Object> run : runs) {
            try {
                if (recoverRun(run)) {
                    recovered++;
                }
            } catch (RuntimeException e) {
                log.warn("Could not recover harness run {}: {}",
                    run.get("id"), e.getMessage());
            }
        }
        if (recovered > 0) {
            log.info("Recovered {} active harness run(s) at startup", recovered);
        }
        return recovered;
    }

    private boolean recoverRun(Map<String, Object> run) {
        String runId = textValue(run.get("id"));
        if (isRunFresh(run)) {
            recoveryDeferred = true;
            log.info("Skipping active harness run {}: heartbeat or lease is still fresh",
                runId);
            return false;
        }

        Long ticketId = longValue(run.get("ticket_id"));
        String branch = textValue(run.get("branch"));
        String step = textValue(run.get("step"));
        Map<String, Object> payload = mapValue(run.get("last_checkpoint_payload"));

        String ticketStatus = textValue(run.get("ticket_status"));
        String ticketPrUrl = textValue(run.get("ticket_pr_url"));
        String headSha = textValue(run.get("head_sha"));
        if (headSha == null) {
            headSha = textValue(payload.get("headSha"));
        }
        String prUrl = textValue(run.get("pr_url"));
        if (prUrl == null) {
            prUrl = textValue(payload.get("prUrl"));
        }
        if (prUrl == null && isResumeMode() && headSha != null && branch != null
            && ("publishing".equals(step) || "done".equals(step))) {
            try {
                prUrl = gitHubService.findPullRequestUrl(branch);
            } catch (IOException | RuntimeException e) {
                log.warn("Could not look up the PR for recovered run {}: {}",
                    runId, e.getMessage());
            }
        }

        if (prUrl != null) {
            // Persist the run-level evidence too, so a later reaper agrees
            // with the ticket even if this process dies before finish.
            persistPublishEvidence(runId, headSha, prUrl);
            // Restore the ticket before finishing the run. If we crash after
            // this point, the run is still active and the next recovery attempt
            // repeats the idempotent adoption instead of leaving a stranded
            // in_progress ticket.
            if (!"done".equals(ticketStatus)
                && !restorePublishedTicket(ticketId, ticketStatus, ticketPrUrl, prUrl)) {
                log.warn("Could not restore ticket {} for published run {}; "
                        + "leaving the run active for retry",
                    ticketId, runId);
                return false;
            }

            String terminal = finishRecoveredRun(
                runId, "succeeded", null, headSha, prUrl);
            if (!"succeeded".equals(terminal)) {
                log.warn("Published run {} finished as '{}' despite publish evidence; "
                        + "leaving reconciliation to the backend",
                    runId, terminal);
                return false;
            }
            reconcileRecoveredRun(runId);
            if (ticketId != null) {
                postMessage(ticketId, "update",
                    "Recovered a published harness run after an agent restart; PR: " + prUrl);
            }
            log.info("Adopted published harness run {} (PR {})", runId, prUrl);
            return true;
        }

        String terminal = finishRecoveredRun(
            runId,
            "failed",
            "Agent restarted before the run finished; restarting cleanly",
            null,
            null
        );
        if (!"failed".equals(terminal)) {
            // Leave the run for the reaper; never release an unconfirmed run
            // or one that another reconciler already published.
            return false;
        }

        boolean released = releaseRecoveredTicket(runId);
        reconcileRecoveredRun(runId);
        if (ticketId != null) {
            postMessage(ticketId, "update", released
                ? "The previous harness run was interrupted by an agent restart; "
                    + "the ticket was returned for a clean retry."
                : "The previous harness run was interrupted by an agent restart; "
                    + "leaving the ticket for operator recovery because it could not "
                    + "be released safely.");
        }
        return true;
    }

    /**
     * Finish a recovered run and return the terminal status the backend
     * actually stored, or null when it could not be confirmed. Callers must
     * branch on that status instead of assuming the requested one was applied.
     */
    private String finishRecoveredRun(
        String runId,
        String status,
        String error,
        String headSha,
        String prUrl
    ) {
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                String terminal = apiService.finishHarnessRun(
                    runId, status, error, headSha, prUrl);
                if (terminal != null && !terminal.equals(status)) {
                    log.warn("Recovered run {} was already terminal as '{}' (wanted '{}')",
                        runId, terminal, status);
                }
                return terminal == null ? status : terminal;
            } catch (IOException | RuntimeException e) {
                if (attempt == 3) {
                    log.warn("Could not reconcile harness run {} during recovery: {}",
                        runId, e.getMessage());
                    return null;
                }
                sleepQuietly(250L * attempt);
            }
        }
        return null;
    }

    private boolean restorePublishedTicket(
        Long ticketId,
        String ticketStatus,
        String ticketPrUrl,
        String prUrl
    ) {
        if (ticketId == null) {
            return true;
        }
        if (ticketPrUrl == null) {
            if (!updateTicketPrUrl(ticketId, prUrl)) {
                return false;
            }
        } else if (!ticketPrUrl.equals(prUrl)) {
            // An older run must not overwrite a newer ticket PR. Keep the
            // ticket's current PR and let the backend reconciliation report
            // the mismatch.
            log.warn("Ticket {} already has PR {}; keeping it instead of {}",
                ticketId, ticketPrUrl, prUrl);
        }

        if ("in_progress".equals(ticketStatus)) {
            return markReview(ticketId);
        }
        // review already has the right status; done is never regressed. The
        // backlog -> review transition is owned by backend reconciliation
        // because the ticket state machine does not allow it through the API.
        return true;
    }

    private void reconcileRecoveredRun(String runId) {
        try {
            apiService.reconcileHarnessRun(runId);
        } catch (IOException | RuntimeException e) {
            // The ticket's PR URL and the backend start guard still prevent a
            // duplicate run; the periodic reaper retries the status move.
            log.warn("Could not reconcile recovered run {} immediately: {}",
                runId, e.getMessage());
        }
    }

    private boolean releaseRecoveredTicket(String runId) {
        try {
            return apiService.releaseHarnessTicket(runId);
        } catch (IOException | RuntimeException e) {
            log.warn("Could not release the ticket for recovered run {}: {}",
                runId, e.getMessage());
            return false;
        }
    }

    private void persistPublishEvidence(String runId, String headSha, String prUrl) {
        try {
            apiService.recordHarnessPublish(runId, headSha, prUrl);
        } catch (IOException | RuntimeException e) {
            log.warn("Could not persist recovered publish evidence for run {}: {}",
                runId, e.getMessage());
        }
    }

    private void recordPublishSafely(String headSha, String prUrl) {
        String runId = currentRunId;
        if (runId == null) {
            return;
        }
        try {
            apiService.recordHarnessPublish(runId, headSha, prUrl);
        } catch (IOException | RuntimeException e) {
            log.warn("Could not persist publish evidence for run {}: {}",
                runId, e.getMessage());
        }
    }

    private boolean isResumeMode() {
        return harnessConfig != null
            && HarnessConfig.RESUME_MODE_RESUME.equals(harnessConfig.resumeMode());
    }

    private boolean updateTicketPrUrl(Long ticketId, String prUrl) {
        if (ticketId == null || prUrl == null) {
            return true;
        }
        try {
            apiService.updateTicketPrUrl(ticketId, prUrl);
            return true;
        } catch (IOException | RuntimeException e) {
            log.warn("Could not restore PR URL on ticket {}: {}", ticketId, e.getMessage());
            return false;
        }
    }

    /** True when recovery skipped a fresh run and should be retried later. */
    public boolean isRecoveryDeferred() {
        return recoveryDeferred;
    }

    private boolean isRunFresh(Map<String, Object> run) {
        Instant now = Instant.now();
        long freshnessSeconds = Math.max(60, heartbeatSeconds * 3);

        Object rawHeartbeat = run.get("heartbeat_at");
        if (rawHeartbeat != null) {
            Instant heartbeat = instantValue(rawHeartbeat);
            if (heartbeat == null) {
                return true;
            }
            if (heartbeat.isAfter(now.minusSeconds(freshnessSeconds))) {
                return true;
            }
        }

        Object rawLease = run.get("lease_expires_at");
        if (rawLease != null) {
            Instant leaseExpiry = instantValue(rawLease);
            if (leaseExpiry == null || leaseExpiry.isAfter(now)) {
                return true;
            }
        }
        return false;
    }

    private static Instant instantValue(Object value) {
        String text = textValue(value);
        if (text == null) {
            return null;
        }
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(text).toInstant();
            } catch (DateTimeParseException ignored) {
                return null;
            }
        }
    }

    private static String textValue(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() || "null".equals(text) ? null : text;
    }

    private static Long longValue(Object value) {
        String text = textValue(value);
        if (text == null) {
            return null;
        }
        try {
            return Long.parseLong(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapValue(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    @Override
    public void processTicket(Ticket ticket) {
        if (ticket == null || ticket.getId() == null) {
            return;
        }
        if (isBackingOff(ticket.getId())) {
            log.info("Ticket {} is in failure backoff or terminal failure state; skipping this poll",
                ticket.getId());
            return;
        }

        log.info("Harness processing ticket: {} - {}",
            ticket.getId(), redactor.redact(ticket.getTitle()));

        Ticket pickedUp = pickUpTicket(ticket.getId());
        if (pickedUp == null) {
            log.warn("Could not pick up ticket {}, skipping", ticket.getId());
            return;
        }

        currentTicketId = String.valueOf(pickedUp.getId());
        currentStep = "processing";
        budgetBreached = false;
        budgetTracker = null;
        budgetPolicy = null;
        routingDecision = null;
        activeHarnessConfig = harnessConfig;
        activeHarness = null;
        terminalEventEmitted = false;
        runStartedAt = Instant.now();
        lastUsageReportAt = 0;
        Instant deadline = Instant.now().plus(maxDuration());

        postMessage(pickedUp.getId(), "update", "Started working on: " + pickedUp.getTitle());

        // Redact before slugification: the slug lowercases and strips
        // punctuation, so redacting afterwards would turn a GitHub token into
        // a non-matching "ghp-..." string. The branch is persisted by the
        // backend, pushed and logged, so it must not carry the raw title.
        String branchName = config.getGitHubBranchName(
            pickedUp.getId(), redactor.redact(pickedUp.getTitle()));

        RepoProfileSnapshot profileSnapshot = null;
        try {
            profileSnapshot = repoProfileSource.fetch();
        } catch (IOException e) {
            log.warn("Could not fetch the repo profile; using autodetection: {}", e.getMessage());
        } catch (IllegalArgumentException e) {
            postMessage(pickedUp.getId(), "update",
                "The active repo profile is invalid: " + e.getMessage()
                    + ". No run was started.");
            release(pickedUp.getId());
            currentTicketId = null;
            currentStep = null;
            return;
        }

        HarnessConfig effectiveHarnessConfig = harnessConfig;
        if (profileSnapshot != null) {
            Duration profileBudget = Duration.ofMinutes(
                profileSnapshot.profile().maxRoundMinutes());
            if (harnessConfig != null && harnessConfig.maxDuration() != null
                && profileBudget.compareTo(harnessConfig.maxDuration()) < 0) {
                effectiveHarnessConfig = harnessConfig.withMaxDuration(profileBudget);
            }
        }
        if (effectiveHarnessConfig != null && effectiveHarnessConfig.maxDuration() != null) {
            deadline = Instant.now().plus(effectiveHarnessConfig.maxDuration());
        }
        activeHarnessConfig = effectiveHarnessConfig;

        if (profileSnapshot != null
            && !profileRepoMatchesConfigured(profileSnapshot.profile())) {
            postMessage(pickedUp.getId(), "update",
                "The active repo profile points at a different repository than "
                    + "REPO_OWNER/REPO_NAME. No run was started.");
            release(pickedUp.getId());
            currentTicketId = null;
            currentStep = null;
            return;
        }

        if (!startDurableRun(pickedUp, branchName, profileSnapshot)) {
            // A live lease or published evidence means this ticket must not be
            // run again automatically. Leave recovery to the operator/reaper.
            String detail = startFailureReason;
            postMessage(pickedUp.getId(), "update",
                "Could not start a durable harness run"
                    + (detail == null || detail.isBlank() ? "" : ": " + detail)
                    + ". Leaving the ticket for operator recovery; no new run was started.");
            startFailureReason = null;
            currentTicketId = null;
            currentStep = null;
            return;
        }

        WorkspaceManager workspace = null;
        HarnessClient harness = null;
        Path tempDir = null;
        SandboxHandle sandbox = null;
        SandboxBashBridge bridge = null;

        try {
            List<String> planningDocs = planningDocFetcher.fetch(pickedUp.getId());
            if (planningDocs == null) {
                planningDocs = List.of();
            }
            log.info("Fetched {} planning documents", planningDocs.size());

            RepoProfile profile = profileSnapshot == null ? null : profileSnapshot.profile();
            SandboxConfig effectiveSandboxConfig = sandboxConfig;
            if (profile != null && sandboxConfig.isDocker()) {
                try {
                    effectiveSandboxConfig = sandboxConfig.withRepoProfile(
                        profile, config.getProjectId(), profileSnapshot.version());
                    if (profile.egress() != null && profile.egress().mtls() != null) {
                        EgressMtlsMaterial material =
                            apiService.getRepoProfileMtls(config.getProjectId());
                        if (material == null) {
                            throw new IllegalStateException(
                                "the active profile requires client-certificate mTLS, "
                                    + "but no active mTLS credential is configured");
                        }
                        if (!new java.util.HashSet<>(material.hosts())
                            .equals(new java.util.HashSet<>(profile.egress().mtls().hosts()))) {
                            throw new IllegalStateException(
                                "the active profile mTLS hosts do not match the credential scope");
                        }
                        effectiveSandboxConfig = effectiveSandboxConfig.withEgressMtls(material);
                    }
                } catch (IOException | RuntimeException e) {
                    failAndRelease(pickedUp.getId(),
                        "The active repo profile cannot be applied: " + e.getMessage());
                    return;
                }
            } else if (profile != null) {
                if (!profile.caches().isEmpty() || profile.image() != null
                    || profile.egress() != null) {
                    log.warn("Repo profile image/caches/egress are ignored in host mode; "
                        + "enable SANDBOX_MODE=docker to use them");
                }
            }

            workspace = workspaceFactory.apply(config.getRepoName());

            if (config.isDryRun()) {
                postMessage(pickedUp.getId(), "status",
                    "DRY RUN: harness execution skipped for branch `" + branchName + "`.");
                release(pickedUp.getId());
                return;
            }

            configureRoutingAndBudget(pickedUp, planningDocs);

            String repoUrl = "https://github.com/" + config.getRepoOwner() + "/"
                + config.getRepoName() + ".git";
            Duration cloneCap = profile == null
                ? CLONE_TIMEOUT
                : Duration.ofMinutes(profile.timeouts().setupMinutes());
            Duration cloneTimeout = remaining(deadline, cloneCap);
            if (profile == null) {
                workspace.cloneRepo(repoUrl, branchName, null, cloneTimeout);
            } else {
                workspace.cloneRepo(repoUrl, branchName, profile.baseBranch(), cloneTimeout);
            }
            java.util.Map<String, Object> cloned = new java.util.HashMap<>();
            cloned.put("workspacePath", String.valueOf(workspace.getRepoDir()));
            if (workspace.getBaseCommit() != null) {
                cloned.put("baseSha", workspace.getBaseCommit());
            }
            if (profileSnapshot != null) {
                cloned.put("repoProfileId", profileSnapshot.id());
                cloned.put("repoProfileVersion", profileSnapshot.version());
            }
            recordCheckpoint("cloned", cloned);

            List<String> commands = safeResolveCommands(workspace, profile);
            if (commands.isEmpty()) {
                failAndRelease(pickedUp.getId(),
                    "No verification commands were detected and HARNESS_VERIFY_COMMANDS is empty. "
                        + "Refusing to publish unverified changes.");
                return;
            }

            // Create the sandbox before the model runs. In Docker mode a
            // create failure is fatal: repo code must never fall back to the
            // supervisor filesystem.
            if (effectiveSandboxConfig.isDocker()) {
                currentStep = "sandbox";
                sandbox = createSandbox(workspace, effectiveSandboxConfig);
                recordCheckpoint("sandbox_ready", Map.of("sandbox", sandbox.id()));

                // Route model-driven bash calls into the same sandbox. A bridge
                // failure is fatal: the model must never fall back to running
                // repo commands on the supervisor filesystem.
                currentStep = "sandbox-bridge";
                bridge = new SandboxBashBridge(
                    sandboxRunner, sandbox, workspace.getRepoDir(),
                    effectiveSandboxConfig.execTimeout());
                try {
                    bridge.start();
                } catch (IOException e) {
                    throw new IOException("Could not start the sandbox bash bridge: "
                        + e.getMessage(), e);
                }
                recordCheckpoint("sandbox_bridge_ready", Map.of());
            }

            tempDir = Files.createTempDirectory("opencode-harness-");
            harness = harnessFactory.create(tempDir, bridge, activeHarnessConfig());
            activeHarness = harness;

            currentStep = "starting-harness";
            harness.start(workspace.getRepoDir());
            String sessionId = harness.createSession("ticket-" + pickedUp.getId());
            if (eventContext != null) {
                eventContext = eventContext.withSessionId(sessionId);
            }
            recordCheckpoint("session_ready", Map.of("sessionId", sessionId));

            currentStep = "implementing";
            String prompt = promptBuilder.build(
                pickedUp, planningDocs, commands, bridge != null,
                effectiveSandboxConfig.networkEnabled());
            emitPromptSent(prompt, planningDocs, commands);
            subscribeHarnessEvents(harness, sessionId);
            try {
                ensureBudgetAllows("before prompt");
                try {
                    harness.sendPrompt(sessionId, prompt);
                } catch (IOException promptFailure) {
                    harness = retryPromptWithFallback(
                        promptFailure, prompt, pickedUp, workspace, bridge, harness);
                }
                ensureBudgetAllows("after prompt");
                if (routingDecision != null) {
                    providerHealth.recordSuccess(routingDecision.model());
                }
                reportUsage(true);
            } finally {
                // The prompt is blocking. Close the harness before verification
                // and publishing so no background process can keep editing the
                // workspace while the supervisor stages and guards the tree.
                closeQuietly(harness);
                harness = null;
                activeHarness = null;
                closeBridge(bridge);
                bridge = null;
            }
            recordCheckpoint("prompting", Map.of());

            currentStep = "installing";
            List<VerificationResult> verification = new ArrayList<>();
            List<String> installCommands = safeResolveInstallCommands(workspace, profile);
            Map<String, String> profileEnv = profile == null
                ? Map.of()
                : (effectiveSandboxConfig.isDocker() ? profile.environment() : profile.env());
            Duration installTimeout = profile == null
                ? INSTALL_TIMEOUT
                : Duration.ofMinutes(profile.timeouts().setupMinutes());
            if (!installCommands.isEmpty()) {
                ensureBudgetAllows("before dependency installation");
                List<VerificationResult> installResults = runVerification(
                    sandbox, workspace, installCommands, remaining(deadline, installTimeout),
                    profileEnv);
                verification.addAll(installResults);
                emitVerificationResults(installResults, "install");
                List<VerificationResult> installFailures = failures(installResults);
                if (!installFailures.isEmpty()) {
                    failAndRelease(pickedUp.getId(),
                        "Dependency installation failed; not publishing.\n\n"
                            + failureDetails(installFailures));
                    return;
                }
            }

            currentStep = "verifying";
            ensureBudgetAllows("before verification");
            Duration verifyTimeout = profile == null
                ? VERIFICATION_TIMEOUT
                : Duration.ofMinutes(profile.timeouts().verifyMinutes());
            List<VerificationResult> verifyResults = runVerification(
                sandbox, workspace, commands, remaining(deadline, verifyTimeout), profileEnv);
            verification.addAll(verifyResults);
            emitVerificationResults(verifyResults, "verify");
            reportUsage(false);
            ensureBudgetAllows("after verification");
            recordCheckpoint("verifying", Map.of());
            if (!verification.isEmpty()) {
                postMessage(pickedUp.getId(), "update", verificationSummary(verification));
            }

            List<VerificationResult> verifyFailures = failures(verifyResults);
            if (!verifyFailures.isEmpty()) {
                failAndRelease(pickedUp.getId(),
                    "Verification failed; not publishing.\n\n" + failureDetails(verifyFailures));
                return;
            }

            // Verification is complete. Destroy the sandbox before staging or
            // publishing so no surviving repo process can edit the workspace
            // between the verification gate and the guarded commit. A failed
            // destroy is fatal: never publish with a live sandbox.
            if (sandbox != null) {
                SandboxHandle verifiedSandbox = sandbox;
                try {
                    sandboxRunner.destroy(verifiedSandbox);
                } catch (IOException | RuntimeException e) {
                    failAndRelease(pickedUp.getId(),
                        "Could not destroy the sandbox before publishing; refusing to "
                            + "stage or push: " + e.getMessage());
                    return;
                }
                sandbox = null;
            }

            if (!assertLeaseHeld(pickedUp.getId())) {
                return;
            }
            currentStep = "publishing";
            recordCheckpoint("publishing", Map.of());
            // Stage into a supervisor-owned index, guard index blobs, then
            // publish exactly the guarded tree. The agent-controlled index and
            // worktree are never trusted.
            try {
                DiffSummary diff = workspace.stageFreshDiff();
                emitDiffCollected(diff);
                try {
                    publishingGuard.assertPublishable(diff);
                    secretLeakGuard.assertClean(workspace.guardedChangedBlobs());
                } catch (IllegalStateException e) {
                    failAndRelease(pickedUp.getId(), "Publishing blocked: " + e.getMessage());
                    return;
                }
                ensureWithinDeadline(deadline);
                ensureBudgetAllows("before publish");
                if (!assertLeaseHeld(pickedUp.getId())) {
                    return;
                }
                String publishTitle = redactor.redact("feat: " + pickedUp.getTitle());
                emitEvent("publish.started", Map.of(
                    "branch", branchName,
                    "changedFiles", diff.changedFileCount(),
                    "changedLines", diff.changedLines()));
                String commitSha = workspace.commitAndPushStaged(publishTitle, branchName);
                published = true;
                publishedHeadSha = commitSha;
                recordPublishSafely(commitSha, null);
                if (!assertLeaseHeld(pickedUp.getId())) {
                    return;
                }
                String prBase = profile == null ? "main" : profile.baseBranchOr("main");
                String prUrl = gitHubService.createPullRequest(
                    publishTitle,
                    buildPrBody(pickedUp, branchName, commitSha, diff, verification),
                    branchName,
                    prBase
                );
                publishedPrUrl = prUrl;
                recordPublishSafely(null, prUrl);
                emitEvent("pr.opened", Map.of(
                    "headSha", commitSha,
                    "prUrl", prUrl == null ? "" : prUrl));

                // Post-publish bookkeeping must never discard a successful push/PR.
                if (prUrl != null && !prUrl.isBlank()) {
                    try {
                        apiService.updateTicketPrUrl(pickedUp.getId(), prUrl);
                    } catch (IOException | RuntimeException e) {
                        log.warn("Push/PR succeeded but updating ticket {} PR URL failed: {}",
                            pickedUp.getId(), e.getMessage());
                    }
                }

                postMessage(pickedUp.getId(), "status",
                    completionSummary(diff, verification, prUrl));
                markReview(pickedUp.getId());
                recordCheckpoint("done", Map.of(
                    "headSha", commitSha,
                    "prUrl", prUrl == null ? "" : prUrl));
                pendingTerminalStatus = "succeeded";
                pendingTerminalMessage = null;
                pendingHeadSha = commitSha;
                pendingPrUrl = prUrl;
                releaseAfterTerminalFinish = false;
                reportUsage(true);
                emitTerminalEvent("succeeded", null, commitSha, prUrl);
                finishDurableRun("succeeded", null, commitSha, prUrl);
                this.failures.remove(pickedUp.getId());
                log.info("Ticket {} completed; PR: {}", pickedUp.getId(), prUrl);
            } finally {
                workspace.discardStaged();
            }
        } catch (ThreadDeath death) {
            throw death;
        } catch (Throwable failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            handleFailure(pickedUp.getId(), failure);
        } finally {
            stopHeartbeat();
            stopBudgetWatchdog();
            String terminalStatus = pendingTerminalStatus == null ? "failed" : pendingTerminalStatus;
            if (!terminalEventEmitted) {
                emitTerminalEvent(terminalStatus, pendingTerminalMessage,
                    pendingHeadSha, pendingPrUrl);
            }
            reportUsage(true);
            if (currentRunId != null) {
                String status = pendingTerminalStatus == null ? "failed" : pendingTerminalStatus;
                String message = pendingTerminalMessage;
                if (message == null && "failed".equals(status)) {
                    message = "Harness run ended without a terminal checkpoint";
                }
                String finishingRunId = currentRunId;
                String actualStatus = finishDurableRun(
                    status, message, pendingHeadSha, pendingPrUrl);
                if (actualStatus != null && releaseAfterTerminalFinish && pickedUp.getId() != null) {
                    if (actualStatus.equals(status)) {
                        applyFailureRelease(pickedUp.getId(), message, finishingRunId);
                    } else {
                        releaseAfterTerminalFinish = false;
                        log.warn("Refusing to release ticket {}: run {} is {}",
                            pickedUp.getId(), finishingRunId, actualStatus);
                        postMessage(pickedUp.getId(), "update", message
                            + "\n\nThe harness run was already " + actualStatus
                            + "; the ticket was left in_progress for operator recovery.");
                    }
                } else if (actualStatus == null && releaseAfterTerminalFinish
                    && pickedUp.getId() != null) {
                    postMessage(pickedUp.getId(), "update",
                        message + "\n\nCould not confirm the harness run finished; "
                            + "leaving the ticket assigned for recovery instead of retrying it.");
                }
            }
            closeQuietly(harness);
            closeBridge(bridge);
            deleteQuietly(tempDir);
            if (sandbox != null) {
                try {
                    sandboxRunner.destroy(sandbox);
                } catch (IOException | RuntimeException e) {
                    log.warn("Could not destroy sandbox {}: {}", sandbox.id(), e.getMessage());
                }
            }
            if (workspace != null) {
                workspace.cleanup();
            }
            currentTicketId = null;
            currentStep = null;
            pendingTerminalStatus = null;
            pendingTerminalMessage = null;
            pendingHeadSha = null;
            pendingPrUrl = null;
            releaseAfterTerminalFinish = false;
            eventContext = null;
            budgetTracker = null;
            routingDecision = null;
            budgetBreached = false;
            terminalEventEmitted = false;
        }
    }

    /**
     * Pick a model from policy and start live metering. Runs before the
     * OpenCode session exists so the router decision is recorded even if the
     * provider then fails.
     */
    private void configureRoutingAndBudget(Ticket ticket, List<String> planningDocs) {
        HarnessBudgetPolicy policy = budgetPolicy != null
            ? budgetPolicy
            : HarnessBudgetPolicy.defaults(maxDuration(), provider);
        budgetPolicy = policy;

        String explicit = harnessConfig == null ? null : harnessConfig.modelOverride();
        BudgetLimits effectiveLimits = policy.effectiveRunLimits();
        ModelRouter.RoutingDecision decision;
        try {
            decision = modelRouter.select(
                policy,
                ticket,
                planningDocs,
                provider,
                effectiveLimits.maxCostUsd(),
                1,
                explicit
            );
        } catch (IOException e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
        routingDecision = decision;

        HarnessConfig baseConfig = activeHarnessConfig != null
            ? activeHarnessConfig
            : harnessConfig;
        if (baseConfig != null) {
            Duration baseDuration = baseConfig.maxDuration();
            Duration budgetDuration = effectiveLimits.maxDuration();
            Duration routedDuration = baseDuration != null
                && baseDuration.compareTo(budgetDuration) < 0
                ? baseDuration
                : budgetDuration;
            activeHarnessConfig = baseConfig
                .withModel(decision.model())
                .withMaxDuration(routedDuration);
        }

        Map<String, Object> routingPayload = new LinkedHashMap<>();
        routingPayload.put("selected", decision.model());
        routingPayload.put("fallback", decision.fallbackModel());
        routingPayload.put("reason", decision.reason());
        routingPayload.put("policy", policy.routingPolicy());
        routingPayload.put("complexity", decision.complexity());
        routingPayload.put("budgetRemainingUsd", decision.budgetRemainingUsd());
        routingPayload.put("dailySpendUsd", policy.dailySpendUsd());
        emitEvent("routing.decided", routingPayload);

        budgetTracker = new HarnessBudgetTracker(
            effectiveLimits,
            policy.priceFor(decision.model()),
            runStartedAt == null ? Instant.now() : runStartedAt,
            this::onBudgetWarning,
            this::handleBudgetBreach
        );
        startBudgetWatchdog();
    }

    private void subscribeHarnessEvents(HarnessClient harness, String sessionId) throws IOException {
        harness.subscribe(sessionId, event -> {
            if (event.isToolEvent()) {
                currentStep = "implementing";
            }
            HarnessBudgetTracker tracker = budgetTracker;
            if (tracker != null) {
                tracker.accept(event).ifPresent(this::emitToolEvent);
            }
        });
    }

    /**
     * One bounded fallback retry for a transient provider failure (fg-38 FR7).
     * The circuit breaker records the primary failure, the fallback model is
     * used only when policy provided one, and the same run/budget is kept.
     */
    private HarnessClient retryPromptWithFallback(
        IOException failure,
        String prompt,
        Ticket ticket,
        WorkspaceManager workspace,
        SandboxBashBridge bridge,
        HarnessClient primary
    ) throws IOException {
        ModelRouter.RoutingDecision decision = routingDecision;
        String fallback = decision == null ? null : decision.fallbackModel();
        if (decision == null
            || fallback == null
            || fallback.isBlank()
            || fallback.equals(decision.model())
            || budgetBreached
            || !providerHealth.isTransient(failure)) {
            throw failure;
        }

        providerHealth.recordFailure(decision.model(), failure);
        Map<String, Object> routingPayload = new LinkedHashMap<>();
        routingPayload.put("selected", fallback);
        routingPayload.put("fallback", decision.model());
        routingPayload.put("reason", "transient provider failure; one fallback retry");
        routingPayload.put("policy", budgetPolicy == null ? null : budgetPolicy.routingPolicy());
        emitEvent("routing.decided", routingPayload);

        routingDecision = new ModelRouter.RoutingDecision(
            fallback,
            decision.model(),
            "transient provider failure; one fallback retry",
            decision.budgetRemainingUsd(),
            decision.complexity()
        );
        if (activeHarnessConfig != null) {
            activeHarnessConfig = activeHarnessConfig.withModel(fallback);
        }
        HarnessBudgetTracker tracker = budgetTracker;
        if (tracker != null && budgetPolicy != null) {
            tracker.updatePrice(budgetPolicy.priceFor(fallback));
        }

        closeQuietly(primary);
        Path retryDir = Files.createTempDirectory("opencode-harness-fallback-");
        HarnessClient retry = harnessFactory.create(retryDir, bridge, activeHarnessConfig());
        activeHarness = retry;
        try {
            currentStep = "starting-harness";
            retry.start(workspace.getRepoDir());
            String sessionId = retry.createSession("ticket-" + ticket.getId());
            if (eventContext != null) {
                eventContext = eventContext.withSessionId(sessionId);
            }
            subscribeHarnessEvents(retry, sessionId);
            ensureBudgetAllows("before fallback prompt");
            retry.sendPrompt(sessionId, prompt);
            ensureBudgetAllows("after fallback prompt");
            providerHealth.recordSuccess(fallback);
            reportUsage(true);
            return retry;
        } catch (IOException | RuntimeException retryFailure) {
            closeQuietly(retry);
            activeHarness = null;
            throw retryFailure;
        }
    }

    private void startBudgetWatchdog() {
        stopBudgetWatchdog();
        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "harness-budget");
            thread.setDaemon(true);
            return thread;
        });
        budgetExecutor = executor;
        executor.scheduleAtFixedRate(() -> {
            HarnessBudgetTracker tracker = budgetTracker;
            if (tracker == null) {
                return;
            }
            try {
                tracker.check();
            } catch (RuntimeException e) {
                log.debug("Harness budget check failed: {}", e.getMessage());
            }
        }, 1, 2, TimeUnit.SECONDS);
    }

    private void stopBudgetWatchdog() {
        ScheduledExecutorService executor = budgetExecutor;
        budgetExecutor = null;
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    private void onBudgetWarning(HarnessBudgetTracker.BudgetWarning warning) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("dimension", warning.dimension());
        payload.put("used", warning.used());
        payload.put("limit", warning.limit());
        payload.put("ratio", warning.ratio());
        emitEvent("budget.warning", payload);
        Long ticketId = ticketIdForEvents();
        if (ticketId != null) {
            postMessage(ticketId, "update", String.format(
                "Harness budget warning: %s at %.0f%% of its limit. The run continues.",
                warning.dimension(), warning.ratio() * 100));
        }
    }

    /**
     * A hard budget breach kills the session before it can publish. The run is
     * finished as budget_exceeded and the ticket is returned for a clean retry.
     */
    private void handleBudgetBreach(String reason) {
        if (budgetBreached) {
            return;
        }
        budgetBreached = true;
        currentStep = "budget-exceeded";
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("reason", reason);
        HarnessBudgetTracker tracker = budgetTracker;
        if (tracker != null) {
            payload.put("usage", tracker.snapshot());
        }
        emitEvent("budget.breach", payload);
        Long ticketId = ticketIdForEvents();
        if (ticketId != null) {
            postMessage(ticketId, "status",
                "Harness budget exceeded (" + reason + "). The session was stopped "
                    + "before publishing and the ticket was returned for a clean retry.");
        }
        HarnessClient harness = activeHarness;
        if (harness != null) {
            closeQuietly(harness);
        }
        stopBudgetWatchdog();
    }

    private void ensureBudgetAllows(String stage) throws IOException {
        HarnessBudgetTracker tracker = budgetTracker;
        if (tracker == null) {
            if (budgetBreached) {
                throw new IOException("Harness budget exceeded " + stage);
            }
            return;
        }
        tracker.check();
        if (tracker.breached() || budgetBreached) {
            throw new IOException(
                "Harness budget exceeded (" + budgetReason() + ") " + stage
                    + "; refusing to continue or publish");
        }
    }

    private void emitRunStarted(Ticket ticket, String branchName, int attempt) {
        HarnessBudgetPolicy policy = budgetPolicy;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("branch", branchName);
        payload.put("attempt", attempt);
        payload.put("provider", provider == null ? null : provider.type());
        payload.put("model", provider == null ? null : provider.model());
        payload.put("ticketId", ticket == null ? null : ticket.getId());
        if (policy != null) {
            payload.put("routingPolicy", policy.routingPolicy());
            payload.put("limits", Map.of(
                "maxDurationSeconds", policy.limits().maxDuration().toSeconds(),
                "maxInputTokens", policy.limits().maxInputTokens(),
                "maxOutputTokens", policy.limits().maxOutputTokens(),
                "maxCostUsd", policy.limits().maxCostUsd(),
                "maxToolCalls", policy.limits().maxToolCalls(),
                "maxRetries", policy.limits().maxRetries()));
        }
        emitEvent("run.started", payload);
    }

    private void emitPromptSent(String prompt, List<String> planningDocs, List<String> commands) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("promptVersion", "v1");
        payload.put("length", prompt == null ? 0 : prompt.length());
        payload.put("sha256", HarnessDigest.sha256(prompt));
        payload.put("planningDocs", planningDocs == null ? 0 : planningDocs.size());
        payload.put("verificationCommands", commands == null ? List.of() : commands);
        payload.put("model", routingDecision == null ? null : routingDecision.model());
        emitEvent("prompt.sent", payload);
    }

    private void emitToolEvent(OpenCodeUsage.ToolCall tool) {
        if (tool == null) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("tool", tool.tool());
        payload.put("callId", tool.callId());
        payload.put("failed", tool.failed());
        if (tool.command() != null) {
            payload.put("commandHash", HarnessDigest.sha256(tool.command()));
            payload.put("commandLength", tool.command().length());
        }
        emitEvent("tool.called", payload);

        if (tool.editsFile()) {
            Map<String, Object> edit = new LinkedHashMap<>();
            edit.put("tool", tool.tool());
            edit.put("path", tool.filePath());
            edit.put("callId", tool.callId());
            emitEvent("file.edited", edit);
        }
    }

    private void emitVerificationResults(List<VerificationResult> results, String phase) {
        if (results == null) {
            return;
        }
        for (VerificationResult result : results) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("phase", phase);
            payload.put("command", result.command());
            payload.put("exitCode", result.exitCode());
            payload.put("passed", result.passed());
            payload.put("timedOut", result.timedOut());
            payload.put("output", result.output());
            emitEvent("verification.result", payload);
        }
    }

    private void emitDiffCollected(DiffSummary diff) {
        if (diff == null) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("changedFiles", diff.changedFileCount());
        payload.put("additions", diff.additions());
        payload.put("deletions", diff.deletions());
        payload.put("changedBytes", diff.changedBytes());
        if (diff.files() != null) {
            payload.put("files", diff.files().stream()
                .limit(100)
                .map(DiffSummary.ChangedFile::path)
                .toList());
        }
        emitEvent("diff.collected", payload);
    }

    private void emitTerminalEvent(String status, String message, String headSha, String prUrl) {
        if (terminalEventEmitted) {
            return;
        }
        terminalEventEmitted = true;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("status", status);
        payload.put("error", message);
        payload.put("headSha", headSha);
        payload.put("prUrl", prUrl);
        payload.put("budgetExceeded", budgetBreached);
        HarnessBudgetTracker tracker = budgetTracker;
        if (tracker != null) {
            payload.put("usage", tracker.snapshot());
        }
        emitEvent("succeeded".equals(status) ? "run.succeeded" : "run.failed", payload);
    }

    private void reportUsage(boolean force) {
        HarnessBudgetTracker tracker = budgetTracker;
        String runId = currentRunId;
        ModelRouter.RoutingDecision decision = routingDecision;
        if (tracker == null || runId == null || decision == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (!force && now - lastUsageReportAt < 30_000L) {
            return;
        }
        HarnessBudgetTracker.UsageSnapshot snapshot = tracker.snapshot();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", decision.model());
        body.put("promptVersion", "v1");
        body.put("configHash", HarnessDigest.sha256(
            decision.model() + "|" + decision.reason()));
        body.put("routingReason", decision.reason());
        body.put("inputTokens", snapshot.inputTokens());
        body.put("outputTokens", snapshot.outputTokens());
        body.put("cachedTokens", snapshot.cachedTokens());
        body.put("toolCalls", snapshot.toolCalls());
        body.put("durationMs", snapshot.durationMs());
        try {
            boolean quotaExceeded = apiService.recordHarnessUsage(runId, body);
            lastUsageReportAt = now;
            emitEvent("usage.recorded", body);
            if (quotaExceeded) {
                HarnessBudgetTracker trackerNow = budgetTracker;
                if (trackerNow != null) {
                    trackerNow.forceBreach("project daily budget exhausted");
                }
            }
        } catch (IOException | RuntimeException e) {
            log.debug("Could not report harness usage for run {}: {}", runId,
                redactWithProvider(String.valueOf(e.getMessage())));
        }
    }

    private Long ticketIdForEvents() {
        HarnessEventContext context = eventContext;
        return context == null ? null : context.ticketId();
    }

    private void emitEvent(String type, Map<String, Object> payload) {
        HarnessEventSink sink = eventSink;
        HarnessEventContext context = eventContext;
        if (sink == null || context == null) {
            return;
        }
        try {
            sink.emit(context, type, payload);
        } catch (RuntimeException e) {
            log.debug("Harness event emission failed for {}: {}", type, e.getMessage());
        }
    }

    private static UUID uuidValue(String value) {
        if (value == null || value.isBlank()) {
            return UUID.randomUUID();
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return UUID.nameUUIDFromBytes(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }

    private Ticket pickUpTicket(Long ticketId) {        try {
            return apiService.pickUpTicket(ticketId);
        } catch (IOException e) {
            log.warn("Could not pick up ticket {}: {}", ticketId, e.getMessage());
            return null;
        }
    }

    private List<String> safeResolveCommands(WorkspaceManager workspace, RepoProfile profile) {
        if (profile != null && !profile.verify().isEmpty()) {
            return profile.verify();
        }
        try {
            Path repoDir = workspace.getRepoDir();
            if (repoDir == null) {
                return List.of();
            }
            List<String> resolved = verificationRunner.resolveCommands(repoDir);
            return resolved == null ? List.of() : resolved;
        } catch (IOException e) {
            log.warn("Could not resolve verification commands: {}", e.getMessage());
            return List.of();
        }
    }

    private List<String> safeResolveInstallCommands(WorkspaceManager workspace, RepoProfile profile) {
        if (profile != null && !profile.setup().isEmpty()) {
            return profile.setup();
        }
        try {
            Path repoDir = workspace.getRepoDir();
            if (repoDir == null) {
                return List.of();
            }
            List<String> resolved = verificationRunner.resolveInstallCommands(repoDir);
            return resolved == null ? List.of() : resolved;
        } catch (IOException e) {
            log.warn("Could not resolve install commands: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Create the per-run sandbox. Any failure is fatal in Docker mode: the
     * harness must not fall back to running repo code on the supervisor.
     */
    private SandboxHandle createSandbox(
        WorkspaceManager workspace,
        SandboxConfig effectiveConfig
    ) throws IOException {
        try {
            SandboxSpec spec = effectiveConfig.specFor(workspace.getRepoDir());
            return sandboxRunner.create(spec);
        } catch (IOException | RuntimeException e) {
            throw new IOException(
                "Sandbox creation failed (" + effectiveConfig.mode() + "): " + e.getMessage()
                    + ". Refusing to run repo code without the requested sandbox.", e);
        }
    }

    /**
     * Route commands through the sandbox when one exists; otherwise keep the
     * Phase 1 host path. The host path is only used when SANDBOX_MODE=host.
     */
    private List<VerificationResult> runVerification(
        SandboxHandle sandbox,
        WorkspaceManager workspace,
        List<String> commands,
        Duration timeout,
        Map<String, String> environment
    ) {
        if (sandbox != null) {
            return verificationRunner.run(sandboxRunner, sandbox, commands, timeout);
        }
        if (environment == null || environment.isEmpty()) {
            return verificationRunner.run(workspace.getRepoDir(), commands, timeout);
        }
        return verificationRunner.run(
            workspace.getRepoDir(), commands, timeout, environment);
    }

    private static List<VerificationResult> failures(List<VerificationResult> results) {
        if (results == null || results.isEmpty()) {
            return List.of();
        }
        return results.stream().filter(result -> !result.passed()).toList();
    }

    private Duration maxDuration() {
        HarnessBudgetPolicy policy = budgetPolicy;
        if (policy != null && policy.limits() != null && policy.limits().maxDuration() != null) {
            return policy.limits().maxDuration();
        }
        return harnessConfig == null || harnessConfig.maxDuration() == null
            ? Duration.ofMinutes(45)
            : harnessConfig.maxDuration();
    }

    private Duration remaining(Instant deadline, Duration cap) throws IOException {
        long remainingMs = Duration.between(Instant.now(), deadline).toMillis();
        if (remainingMs <= 0) {
            throw new IOException("Ticket wall-clock budget exhausted before verification/publish");
        }
        long capMs = cap == null ? remainingMs : cap.toMillis();
        return Duration.ofMillis(Math.max(1, Math.min(remainingMs, capMs)));
    }

    private void ensureWithinDeadline(Instant deadline) throws IOException {
        if (Instant.now().isAfter(deadline)) {
            throw new IOException("Ticket wall-clock budget exhausted; refusing to publish");
        }
    }

    private void handleFailure(Long ticketId, Throwable failure) {
        if (!budgetBreached && routingDecision != null) {
            providerHealth.recordFailure(routingDecision.model(), failure);
        }
        String message = budgetBreached
            ? "Harness budget exceeded: " + budgetReason()
            : redactWithProvider(failure.getMessage() == null
                ? failure.getClass().getSimpleName()
                : failure.getMessage());
        log.error("Harness failed for ticket {}: {}", ticketId, message);
        if (log.isDebugEnabled() && !budgetBreached) {
            // The throwable is not passed to SLF4J: its message and causes are
            // another persisted-log boundary and must be redacted too.
            log.debug("Harness failure stack for ticket {}:\n{}", ticketId,
                redactWithProvider(stackTrace(failure)));
        }
        failAndRelease(ticketId, budgetBreached ? message : "Harness failed: " + message);
    }

    private String budgetReason() {
        HarnessBudgetTracker tracker = budgetTracker;
        return tracker == null || tracker.breachReason() == null
            ? "hard limit reached"
            : tracker.breachReason();
    }

    private static String stackTrace(Throwable failure) {
        StringWriter writer = new StringWriter();
        failure.printStackTrace(new PrintWriter(writer));
        return writer.toString();
    }

    /**
     * Persist the run and claim its lease.
     *
     * Only the initial startRun failure is best-effort during rollout (unless
     * HARNESS_DURABILITY_REQUIRED=true). Once a run exists, every lease/auth
     * failure fails closed: the harness must not publish without the lease.
     */
    private boolean profileRepoMatchesConfigured(RepoProfile profile) {
        if (profile == null || profile.repoUrl() == null || profile.repoUrl().isBlank()) {
            return true;
        }
        if (config.getRepoOwner() == null || config.getRepoOwner().isBlank()
            || config.getRepoName() == null || config.getRepoName().isBlank()) {
            return true;
        }
        String configured = "https://github.com/" + config.getRepoOwner() + "/"
            + config.getRepoName();
        return normalizeRepoUrl(profile.repoUrl()).equals(normalizeRepoUrl(configured));
    }

    private static String normalizeRepoUrl(String value) {
        return String.valueOf(value).trim()
            .replaceAll("\\.git$", "")
            .replaceAll("/+$", "")
            .toLowerCase(java.util.Locale.ROOT);
    }

    private boolean startDurableRun(
        Ticket ticket,
        String branchName,
        RepoProfileSnapshot profile
    ) {
        leaseLost = false;
        startFailureReason = null;
        published = false;
        publishedHeadSha = null;
        publishedPrUrl = null;
        pendingTerminalStatus = null;
        pendingTerminalMessage = null;
        pendingHeadSha = null;
        pendingPrUrl = null;
        releaseAfterTerminalFinish = false;
        eventContext = null;
        budgetPolicy = null;
        terminalEventEmitted = false;
        runStartedAt = Instant.now();
        if (config.isDryRun()) {
            return true;
        }

        FailureState state = failures.get(ticket.getId());
        int attempt = state == null ? 1 : Math.min(state.attempts + 1, maxAttempts);

        Map<String, Object> run;
        try {
            if (profile == null) {
                run = apiService.startHarnessRun(
                    ticket.getId(),
                    branchName,
                    null,
                    provider == null ? null : provider.type(),
                    provider == null ? null : provider.model(),
                    attempt
                );
            } else {
                run = apiService.startHarnessRun(
                    ticket.getId(),
                    branchName,
                    null,
                    provider == null ? null : provider.type(),
                    provider == null ? null : provider.model(),
                    attempt,
                    profile.id(),
                    profile.version()
                );
            }
        } catch (ApiService.FatalRunException e) {
            // The backend explicitly refused the run (another active run,
            // unauthorized ticket, invalid payload). Never publish anyway.
            log.error("Harness run rejected for ticket {}: {}",
                ticket.getId(), e.getMessage());
            startFailureReason = e.getMessage();
            return false;
        } catch (IOException | RuntimeException e) {
            if (durabilityRequired) {
                log.error("Harness run persistence is required but failed for ticket {}: {}",
                    ticket.getId(), e.getMessage());
                return false;
            }
            log.warn("Harness run persistence unavailable for ticket {}: {}",
                ticket.getId(), e.getMessage());
            return true;
        }

        if (run == null || run.get("id") == null) {
            if (durabilityRequired) {
                log.error("Harness run persistence is required but returned no run for ticket {}",
                    ticket.getId());
                return false;
            }
            log.debug("Harness run persistence unavailable for ticket {}", ticket.getId());
            return true;
        }

        currentRunId = String.valueOf(run.get("id"));

        Long projectId = longValue(run.get("project_id"));
        if (projectId == null) {
            projectId = longValue(run.get("ticket_project_id"));
        }
        if (projectId == null && ticket != null) {
            projectId = ticket.getProjectId();
        }
        Long agentId = longValue(config.getAgentId());
        eventContext = new HarnessEventContext(
            UUID.randomUUID(),
            uuidValue(currentRunId),
            ticket == null ? null : ticket.getId(),
            projectId,
            agentId,
            null
        );
        budgetPolicy = HarnessBudgetPolicy.from(
            apiService.getLastBudgetPolicy(), maxDuration(), provider);
        emitRunStarted(ticket, branchName, attempt);
        try {
            boolean leased = apiService.claimHarnessLease(
                ticket.getId(), currentRunId, leaseTtlSeconds);
            if (!leased) {
                log.warn("Ticket {} is leased by another active harness run", ticket.getId());
                emitTerminalEvent("failed", "Ticket is leased by another active harness run",
                    null, null);
                finishDurableRun("failed",
                    "Ticket is leased by another active harness run", null, null);
                currentRunId = null;
                return false;
            }
        } catch (IOException | RuntimeException e) {
            log.warn("Could not claim the harness lease for ticket {}: {}",
                ticket.getId(), e.getMessage());
            emitTerminalEvent("failed", "Harness lease claim failed: " + e.getMessage(),
                null, null);
            finishDurableRun("failed",
                "Harness lease claim failed: " + e.getMessage(), null, null);
            currentRunId = null;
            return false;
        }

        startHeartbeat(ticket.getId());
        return true;
    }

    private void recordCheckpoint(String step, Map<String, Object> payload) {
        Map<String, Object> eventPayload = new LinkedHashMap<>();
        eventPayload.put("step", step);
        if (payload != null) {
            eventPayload.putAll(payload);
        }
        emitEvent("step.changed", eventPayload);

        HarnessBudgetTracker tracker = budgetTracker;
        if (tracker != null) {
            tracker.check();
        }

        String runId = currentRunId;
        if (runId == null) {
            return;
        }
        try {
            apiService.checkpointHarnessRun(runId, step, payload);
            reportUsage(false);
        } catch (ApiService.RunGoneException e) {
            // The run was reaped or finished elsewhere: stop before publishing.
            leaseLost = true;
            stopHeartbeat();
            log.warn("Harness run {} is gone; aborting before publish: {}", runId, e.getMessage());
        } catch (IOException | RuntimeException e) {
            log.warn("Failed to record harness checkpoint '{}' for run {}: {}",
                step, runId, e.getMessage());
        }
    }

    /**
     * Retry finish so a successful publish is not lost to a transient API
     * failure. The run id is cleared only after the backend confirms, and the
     * backend finish is idempotent.
     */
    private String finishDurableRun(String status, String error, String headSha, String prUrl) {
        String runId = currentRunId;
        if (runId == null) {
            return status;
        }
        stopHeartbeat();

        Exception lastFailure = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                String terminal = apiService.finishHarnessRun(
                    runId,
                    status,
                    error == null ? null : redactWithProvider(error),
                    headSha,
                    prUrl
                );
                if (terminal != null && !terminal.equals(status)) {
                    log.warn("Harness run {} was already terminal as '{}' when finishing as '{}'",
                        runId, terminal, status);
                }
                currentRunId = null;
                return terminal == null ? status : terminal;
            } catch (IOException | RuntimeException e) {
                lastFailure = e;
                if (attempt < 3) {
                    sleepQuietly(250L * attempt);
                }
            }
        }

        log.warn("Could not finish harness run {}: {}", runId,
            lastFailure == null ? "unknown error" : lastFailure.getMessage());
        return null;
    }

    private boolean assertLeaseHeld(Long ticketId) {
        if (!leaseLost && currentRunId != null) {
            try {
                if (!apiService.renewHarnessLease(ticketId, currentRunId, leaseTtlSeconds)) {
                    leaseLost = true;
                }
            } catch (IOException | RuntimeException e) {
                // An expired/partitioned lease is indistinguishable from a
                // transient error here; fail closed rather than publish.
                leaseLost = true;
                log.warn("Could not verify the harness lease before publish for ticket {}: {}",
                    ticketId, e.getMessage());
            }
        }

        if (!leaseLost) {
            return true;
        }
        postMessage(ticketId, "update",
            "Harness lease was lost before publish; refusing to push or open a PR. "
                + "The ticket is left for recovery.");
        pendingTerminalStatus = "failed";
        pendingTerminalMessage = "Harness lease lost during publish";
        pendingHeadSha = publishedHeadSha;
        pendingPrUrl = publishedPrUrl;
        releaseAfterTerminalFinish = false;
        finishDurableRun(
            "failed", "Harness lease lost during publish",
            publishedHeadSha, publishedPrUrl);
        return false;
    }

    private void startHeartbeat(Long ticketId) {
        String runId = currentRunId;
        if (runId == null) {
            return;
        }
        long intervalSeconds = Math.max(1, heartbeatSeconds);
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "harness-heartbeat-" + ticketId);
            thread.setDaemon(true);
            return thread;
        });
        heartbeatExecutor.scheduleAtFixedRate(() -> {
            if (!heartbeatOnce(ticketId, runId)) {
                stopHeartbeat();
            }
        }, intervalSeconds, intervalSeconds, TimeUnit.SECONDS);
    }

    /**
     * One heartbeat tick. Transient errors keep the loop alive; an explicit
     * lease loss flips leaseLost so publishing fails closed.
     */
    boolean heartbeatOnce(Long ticketId, String runId) {
        try {
            if (!apiService.renewHarnessLease(ticketId, runId, leaseTtlSeconds)) {
                leaseLost = true;
                HarnessClient active = activeHarness;
                if (active != null) {
                    // A kill switch or another owner withdraws the lease. Stop
                    // the session now so it cannot keep spending budget until
                    // the next publish gate.
                    closeQuietly(active);
                }
                log.warn("Harness lease for ticket {} is no longer held; stopping heartbeats",
                    ticketId);
                return false;
            }
            apiService.heartbeatHarnessRun(runId, currentStep);
            return true;
        } catch (ApiService.RunGoneException e) {
            leaseLost = true;
            log.warn("Harness run {} is gone; stopping heartbeats: {}", runId, e.getMessage());
            return false;
        } catch (IOException | RuntimeException e) {
            // Transient: leave the lease alone and retry on the next tick.
            log.debug("Harness heartbeat failed for ticket {}; will retry: {}",
                ticketId, e.getMessage());
            return true;
        }
    }

    private void stopHeartbeat() {
        ScheduledExecutorService executor = heartbeatExecutor;
        heartbeatExecutor = null;
        if (executor != null) {
            executor.shutdown();
        }
    }

    /**
     * Post a failure and release the ticket with exponential backoff. Without
     * this, the poll loop re-picks the same ticket every 30 seconds and runs
     * another multi-minute harness.
     */
    private void failAndRelease(Long ticketId, String message) {
        if (budgetBreached) {
            // fg-38 FR3: a breached run stops with budget_exceeded, never
            // publishes partial work, and returns the ticket for a clean retry.
            pendingTerminalStatus = "budget_exceeded";
            pendingTerminalMessage = message;
            pendingHeadSha = publishedHeadSha;
            pendingPrUrl = publishedPrUrl;
            releaseAfterTerminalFinish = false;
            reportUsage(true);
            String runId = currentRunId;
            String actualStatus = finishDurableRun(
                "budget_exceeded", message, publishedHeadSha, publishedPrUrl);
            if (actualStatus == null) {
                log.warn("Could not confirm the budget-exceeded finish for ticket {}; "
                    + "leaving the run active for recovery", ticketId);
                return;
            }
            if (!"budget_exceeded".equals(actualStatus)) {
                log.warn("Refusing to release ticket {}: run {} is {}",
                    ticketId, runId, actualStatus);
                return;
            }
            if (published) {
                log.warn("Budget exceeded after publish for ticket {}; leaving the ticket "
                    + "for operator review", ticketId);
                return;
            }
            if (runId != null) {
                if (!releaseRecoveredTicket(runId)) {
                    log.warn("Ticket {} was not released after a budget breach; "
                        + "the reaper will reconcile the terminal run", ticketId);
                }
            } else {
                release(ticketId);
            }
            return;
        }

        // Failures that already published work are never retried automatically,
        // so keep their terminal status failed and let publish evidence win.
        boolean terminal = !published
            && failures.computeIfAbsent(ticketId, ignored -> new FailureState())
                .nextAttempt() >= maxAttempts;
        pendingTerminalStatus = terminal ? "dead_letter" : "failed";
        pendingTerminalMessage = message;
        // Preserve publish evidence on the failed finish so the backend guard
        // refuses to return a pushed branch to backlog.
        pendingHeadSha = publishedHeadSha;
        pendingPrUrl = publishedPrUrl;
        releaseAfterTerminalFinish = true;

        String runId = currentRunId;
        String requestedStatus = pendingTerminalStatus;
        String actualStatus = finishDurableRun(
            requestedStatus, message, publishedHeadSha, publishedPrUrl);
        if (actualStatus == null) {
            // The run/lease may still be live. The finally block retries the
            // finish and applies the backoff + release only if it succeeds.
            log.warn("Could not confirm the harness run finished for ticket {}; "
                + "deferring ticket release", ticketId);
            return;
        }
        if (!actualStatus.equals(requestedStatus)) {
            // An operator dead-letter (or another terminal state) already holds
            // the ticket. Never release it from the agent failure path.
            releaseAfterTerminalFinish = false;
            log.warn("Refusing to release ticket {}: run {} is {}", ticketId, runId, actualStatus);
            postMessage(ticketId, "update", message
                + "\n\nThe harness run was already " + actualStatus
                + "; the ticket was left in_progress for operator recovery.");
            return;
        }

        applyFailureRelease(ticketId, message, runId);
    }

    private void applyFailureRelease(Long ticketId, String message, String runId) {
        if (published) {
            // The branch was already pushed (and possibly a PR created). Never
            // return a published ticket to backlog just because a later step
            // failed; the guarded/reconcile paths own the final state.
            log.warn("Refusing to release ticket {} after publish; leaving it for "
                + "operator or reconciliation", ticketId);
            postMessage(ticketId, "update",
                message + "\n\nThe branch was already published, so the ticket was "
                    + "left for operator review instead of being returned to backlog.");
            return;
        }

        FailureState state = failures.computeIfAbsent(ticketId, ignored -> new FailureState());
        int attempt = state.recordFailure(maxAttempts, retryBaseDelayMs, retryMaxDelayMs);
        if (state.isTerminal()) {
            releaseAfterTerminalFinish = false;
            log.warn("Ticket {} exhausted {} automatic attempt(s); leaving it in_progress "
                + "for operator recovery", ticketId, maxAttempts);
            postMessage(ticketId, "update", message
                + "\n\nAutomatic retries exhausted after "
                + Math.min(attempt, maxAttempts) + "/" + maxAttempts
                + " attempts. The harness run was marked dead_letter and the ticket was "
                + "left in_progress for operator recovery. Release the ticket, then restart "
                + "this agent (or use a fresh agent) before it can be retried.");
            return;
        }
        String note = " (attempt " + attempt + "/" + maxAttempts
            + ", retry after "
            + Math.max(0, (state.nextAttemptAt - System.currentTimeMillis()) / 1000) + "s)";
        postMessage(ticketId, "update", message + note);

        // Route every run-bound release through the backend guard. It refuses
        // reviewed tickets, tickets with a PR and runs with publish evidence.
        if (runId != null) {
            boolean released = releaseRecoveredTicket(runId);
            if (!released) {
                log.warn("Ticket {} was not released by the guarded path; "
                    + "the reaper will reconcile the terminal run", ticketId);
            }
            return;
        }

        // No durable run exists (dry run / best-effort persistence): use the
        // legacy ticket release, which cannot have published work behind it.
        release(ticketId);
    }

    private boolean isBackingOff(Long ticketId) {
        FailureState state = failures.get(ticketId);
        return state != null
            && (state.isTerminal() || System.currentTimeMillis() < state.nextAttemptAt);
    }

    /**
     * Retry the final status update a few times: a successful push/PR must not
     * leave the ticket in_progress merely because the API blipped.
     */
    private boolean markReview(Long ticketId) {
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                apiService.updateTicketStatus(ticketId, "review");
                return true;
            } catch (IOException | RuntimeException e) {
                if (attempt == 3) {
                    log.warn("Push/PR succeeded but updating ticket {} status failed after {} attempts: {}",
                        ticketId, attempt, e.getMessage());
                    postMessage(ticketId, "update",
                        "Push/PR succeeded, but could not set status to review. Manual status update required.");
                    return false;
                }
                sleepQuietly(250);
            }
        }
        return false;
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void release(Long ticketId) {
        try {
            Ticket released = apiService.releaseTicket(ticketId);
            log.info("Released ticket {}, status: {}", ticketId,
                released != null ? released.getStatus() : "null");
        } catch (IOException e) {
            log.error("Failed to release ticket {}: {}", ticketId, e.getMessage());
        }
    }

    private static int intEnv(String name, int fallback) {
        try {
            String value = System.getenv(name);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            int parsed = Integer.parseInt(value.trim());
            return parsed > 0 ? parsed : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long longEnv(String name, long fallback) {
        try {
            String value = System.getenv(name);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            long parsed = Long.parseLong(value.trim());
            return parsed >= 0 ? parsed : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static boolean booleanEnv(String name, boolean fallback) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        return "true".equalsIgnoreCase(value.trim()) || "1".equals(value.trim());
    }

    private static final class FailureState {
        private int attempts;
        private long nextAttemptAt;
        private boolean terminal;

        private synchronized int recordFailure(int maxAttempts, long baseDelayMs, long maxDelayMs) {
            attempts++;
            if (attempts >= maxAttempts) {
                // Terminal/manual policy: do not schedule another automatic
                // attempt and do not release the ticket back to the backlog.
                terminal = true;
                nextAttemptAt = Long.MAX_VALUE;
            } else {
                nextAttemptAt = System.currentTimeMillis()
                    + retryDelayMillis(attempts, maxAttempts, baseDelayMs, maxDelayMs);
            }
            return attempts;
        }

        private synchronized int nextAttempt() {
            return attempts + 1;
        }

        private synchronized boolean isTerminal() {
            return terminal;
        }
    }

    static long retryDelayMillis(
        int attempt,
        int maxAttempts,
        long baseDelayMs,
        long maxDelayMs
    ) {
        long exponent = Math.min(Math.max(0, attempt - 1), 10);
        long delay = Math.min(maxDelayMs, baseDelayMs * (1L << exponent));
        return attempt >= maxAttempts ? maxDelayMs : Math.max(0, delay);
    }

    private void postMessage(Long ticketId, String type, String content) {
        try {
            // Redact before storage: ticket messages are persisted by the
            // backend and may contain bounded sandbox/verification output.
            String safe = truncate(redactor.redact(content));
            TicketMessage ignored = apiService.postMessage(ticketId, type, safe);
            if (ignored == null) {
                log.debug("Ticket message returned no body for ticket {}", ticketId);
            }
        } catch (IOException | RuntimeException e) {
            log.warn("Failed to post {} message on ticket {}: {}", type, ticketId, e.getMessage());
        }
    }

    private String verificationSummary(List<VerificationResult> results) {
        StringBuilder summary = new StringBuilder("Verification results:\n");
        for (VerificationResult result : results) {
            String status = result.passed() ? "PASS" : (result.timedOut() ? "TIMEOUT" : "FAIL");
            summary.append("- [").append(status).append("] `")
                .append(result.command()).append('`');
            if (!result.passed()) {
                summary.append(" (exit ").append(result.exitCode()).append(')');
            }
            summary.append('\n');
        }
        return summary.toString().trim();
    }

    private String failureDetails(List<VerificationResult> failures) {
        String details = failures.stream()
            .map(result -> "$ " + result.command() + "\n" + result.output())
            .collect(Collectors.joining("\n\n"));
        return "```\n" + truncate(redactWithProvider(details)) + "\n```";
    }

    private String completionSummary(
        DiffSummary diff,
        List<VerificationResult> verification,
        String prUrl
    ) {
        String files = diff.files().stream()
            .map(file -> "- " + file.status() + ": `" + file.path() + "`")
            .collect(Collectors.joining("\n"));
        long passed = verification.stream().filter(VerificationResult::passed).count();
        return "Harness completed.\n\n"
            + "Changed files (" + diff.changedFileCount() + "):\n" + files + "\n\n"
            + "Verification: " + passed + "/" + verification.size() + " passed\n"
            + (prUrl == null || prUrl.isBlank() ? "" : "PR: " + prUrl);
    }

    private String buildPrBody(
        Ticket ticket,
        String branchName,
        String commitSha,
        DiffSummary diff,
        List<VerificationResult> verification
    ) {
        StringBuilder body = new StringBuilder();
        body.append("## Ticket\n");
        body.append("**Title:** ").append(ticket.getTitle()).append('\n');
        body.append("**Description:** ").append(ticket.getDescription()).append("\n\n");
        body.append("**Branch:** `").append(branchName).append("`\n");
        if (commitSha != null) {
            body.append("**Commit:** `").append(commitSha).append("`\n");
        }

        body.append("\n## Changed files\n");
        for (DiffSummary.ChangedFile file : diff.files()) {
            body.append("- ").append(file.status()).append(": `").append(file.path()).append("`\n");
        }

        body.append("\n## Verification\n");
        if (verification.isEmpty()) {
            body.append("- No verification commands detected\n");
        } else {
            for (VerificationResult result : verification) {
                body.append("- ").append(result.passed() ? "PASS" : "FAIL")
                    .append(": `").append(result.command()).append("`\n");
            }
        }

        body.append("\n---\nGenerated by the Vibecode OpenCode harness (supervisor-owned publishing).\n");
        // The PR body is stored on the remote and may quote ticket content or
        // command text; keep the same redaction boundary as ticket messages.
        return redactor.redact(body.toString());
    }

    private String redactWithProvider(String value) {
        return redactor.redact(value);
    }

    private static String truncate(String value) {
        if (value == null) {
            return "";
        }
        return value.length() > MAX_MESSAGE_CHARS
            ? value.substring(value.length() - MAX_MESSAGE_CHARS)
            : value;
    }

    private static void closeQuietly(HarnessClient harness) {
        if (harness == null) {
            return;
        }
        try {
            harness.close();
        } catch (RuntimeException e) {
            log.warn("Failed to close harness client: {}", e.getMessage());
        }
    }

    private static void closeBridge(SandboxBashBridge bridge) {
        if (bridge == null) {
            return;
        }
        try {
            bridge.close();
        } catch (RuntimeException e) {
            log.warn("Failed to close sandbox bash bridge: {}", e.getMessage());
        }
    }

    private static void deleteQuietly(Path tempDir) {
        if (tempDir == null || !Files.exists(tempDir)) {
            return;
        }
        try (var stream = Files.walk(tempDir)) {
            stream.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // Best effort cleanup.
                }
            });
        } catch (IOException e) {
            log.debug("Could not remove harness temp directory {}: {}", tempDir, e.getMessage());
        }
    }
}
