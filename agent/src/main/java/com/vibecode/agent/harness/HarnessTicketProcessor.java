package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubService;
import com.vibecode.agent.service.TicketWorker;
import com.vibecode.agent.service.WorkspaceManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
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

    private static final Logger log = LoggerFactory.getLogger(HarnessTicketProcessor.class);
    private static final int MAX_MESSAGE_CHARS = 8_192;
    private static final Duration VERIFICATION_TIMEOUT = Duration.ofMinutes(10);
    private static final Duration INSTALL_TIMEOUT = Duration.ofMinutes(10);
    private static final int DEFAULT_MAX_ATTEMPTS = 3;
    private static final long DEFAULT_RETRY_BASE_DELAY_MS = 60_000L;
    private static final long DEFAULT_RETRY_MAX_DELAY_MS = 60L * 60_000L;

    private final AgentConfig config;
    private final ApiService apiService;
    private final ProviderSettings provider;
    private final GitHubService gitHubService;
    private final String githubToken;
    private final HarnessConfig harnessConfig;
    private final Function<String, WorkspaceManager> workspaceFactory;
    private final Function<Path, HarnessClient> harnessFactory;
    private final PlanningDocFetcher planningDocFetcher;
    private final VerificationRunner verificationRunner;
    private final PublishingGuard publishingGuard;
    private final PromptBuilder promptBuilder = new PromptBuilder();
    private final Map<Long, FailureState> failures = new ConcurrentHashMap<>();
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
        this(
            config,
            apiService,
            provider,
            gitHubService,
            githubToken,
            harnessConfig,
            repoName -> new WorkspaceManager(
                config.getRepoCloneDir(), repoName, config.isDryRun(), githubToken),
            tempDir -> new OpenCodeClient(harnessConfig, provider, tempDir),
            new PlanningDocFetcher(apiService, config),
            new VerificationRunner(harnessConfig),
            new PublishingGuard(harnessConfig.protectedPaths())
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
        Function<Path, HarnessClient> harnessFactory,
        PlanningDocFetcher planningDocFetcher,
        VerificationRunner verificationRunner,
        PublishingGuard publishingGuard
    ) {
        this.config = config;
        this.apiService = apiService;
        this.provider = provider;
        this.gitHubService = gitHubService;
        this.githubToken = githubToken;
        this.harnessConfig = harnessConfig;
        this.workspaceFactory = workspaceFactory;
        this.harnessFactory = harnessFactory;
        this.planningDocFetcher = planningDocFetcher;
        this.verificationRunner = verificationRunner;
        this.publishingGuard = publishingGuard;
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
            log.info("Ticket {} is in failure backoff; skipping this poll", ticket.getId());
            return;
        }

        log.info("Harness processing ticket: {} - {}", ticket.getId(), ticket.getTitle());

        Ticket pickedUp = pickUpTicket(ticket.getId());
        if (pickedUp == null) {
            log.warn("Could not pick up ticket {}, skipping", ticket.getId());
            return;
        }

        currentTicketId = String.valueOf(pickedUp.getId());
        currentStep = "processing";
        Instant deadline = Instant.now().plus(maxDuration());

        postMessage(pickedUp.getId(), "update", "Started working on: " + pickedUp.getTitle());

        String branchName = config.getGitHubBranchName(pickedUp.getId(), pickedUp.getTitle());
        if (!startDurableRun(pickedUp, branchName)) {
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

        try {
            List<String> planningDocs = planningDocFetcher.fetch(pickedUp.getId());
            if (planningDocs == null) {
                planningDocs = List.of();
            }
            log.info("Fetched {} planning documents", planningDocs.size());

            workspace = workspaceFactory.apply(config.getRepoName());

            if (config.isDryRun()) {
                postMessage(pickedUp.getId(), "status",
                    "DRY RUN: harness execution skipped for branch `" + branchName + "`.");
                release(pickedUp.getId());
                return;
            }

            String repoUrl = "https://github.com/" + config.getRepoOwner() + "/"
                + config.getRepoName() + ".git";
            workspace.cloneRepo(repoUrl, branchName);
            java.util.Map<String, Object> cloned = new java.util.HashMap<>();
            cloned.put("workspacePath", String.valueOf(workspace.getRepoDir()));
            if (workspace.getBaseCommit() != null) {
                cloned.put("baseSha", workspace.getBaseCommit());
            }
            recordCheckpoint("cloned", cloned);

            List<String> commands = safeResolveCommands(workspace);
            if (commands.isEmpty()) {
                failAndRelease(pickedUp.getId(),
                    "No verification commands were detected and HARNESS_VERIFY_COMMANDS is empty. "
                        + "Refusing to publish unverified changes.");
                return;
            }

            tempDir = Files.createTempDirectory("opencode-harness-");
            harness = harnessFactory.apply(tempDir);

            currentStep = "starting-harness";
            harness.start(workspace.getRepoDir());
            String sessionId = harness.createSession("ticket-" + pickedUp.getId());
            recordCheckpoint("session_ready", Map.of("sessionId", sessionId));

            currentStep = "implementing";
            String prompt = promptBuilder.build(pickedUp, planningDocs, commands);
            harness.subscribe(sessionId, event -> {
                if (event.isToolEvent()) {
                    currentStep = "implementing";
                }
            });
            try {
                harness.sendPrompt(sessionId, prompt);
            } finally {
                // The prompt is blocking. Close the harness before verification
                // and publishing so no background process can keep editing the
                // workspace while the supervisor stages and guards the tree.
                closeQuietly(harness);
                harness = null;
            }
            recordCheckpoint("prompting", Map.of());

            currentStep = "installing";
            List<VerificationResult> verification = new ArrayList<>();
            List<String> installCommands = safeResolveInstallCommands(workspace);
            if (!installCommands.isEmpty()) {
                List<VerificationResult> installResults = verificationRunner.run(
                    workspace.getRepoDir(), installCommands, remaining(deadline, INSTALL_TIMEOUT));
                verification.addAll(installResults);
                List<VerificationResult> installFailures = failures(installResults);
                if (!installFailures.isEmpty()) {
                    failAndRelease(pickedUp.getId(),
                        "Dependency installation failed; not publishing.\n\n"
                            + failureDetails(installFailures));
                    return;
                }
            }

            currentStep = "verifying";
            List<VerificationResult> verifyResults = verificationRunner.run(
                workspace.getRepoDir(), commands, remaining(deadline, VERIFICATION_TIMEOUT));
            verification.addAll(verifyResults);
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
                try {
                    publishingGuard.assertPublishable(diff);
                } catch (IllegalStateException e) {
                    failAndRelease(pickedUp.getId(), "Publishing blocked: " + e.getMessage());
                    return;
                }
                ensureWithinDeadline(deadline);
                if (!assertLeaseHeld(pickedUp.getId())) {
                    return;
                }
                String commitSha = workspace.commitAndPushStaged(
                    "feat: " + pickedUp.getTitle(), branchName);
                published = true;
                publishedHeadSha = commitSha;
                recordPublishSafely(commitSha, null);
                if (!assertLeaseHeld(pickedUp.getId())) {
                    return;
                }
                String prUrl = gitHubService.createPullRequest(
                    "feat: " + pickedUp.getTitle(),
                    buildPrBody(pickedUp, branchName, commitSha, diff, verification),
                    branchName,
                    "main"
                );
                publishedPrUrl = prUrl;
                recordPublishSafely(null, prUrl);

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
            if (currentRunId != null) {
                String status = pendingTerminalStatus == null ? "failed" : pendingTerminalStatus;
                String message = pendingTerminalMessage;
                if (message == null && "failed".equals(status)) {
                    message = "Harness run ended without a terminal checkpoint";
                }
                String finishingRunId = currentRunId;
                boolean finished = finishDurableRun(
                    status, message, pendingHeadSha, pendingPrUrl);
                if (finished && releaseAfterTerminalFinish && pickedUp.getId() != null) {
                    applyFailureRelease(pickedUp.getId(), message, finishingRunId);
                } else if (!finished && releaseAfterTerminalFinish && pickedUp.getId() != null) {
                    postMessage(pickedUp.getId(), "update",
                        message + "\n\nCould not confirm the harness run finished; "
                            + "leaving the ticket assigned for recovery instead of retrying it.");
                }
            }
            closeQuietly(harness);
            deleteQuietly(tempDir);
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

    private List<String> safeResolveCommands(WorkspaceManager workspace) {
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

    private List<String> safeResolveInstallCommands(WorkspaceManager workspace) {
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

    private static List<VerificationResult> failures(List<VerificationResult> results) {
        if (results == null || results.isEmpty()) {
            return List.of();
        }
        return results.stream().filter(result -> !result.passed()).toList();
    }

    private Duration maxDuration() {
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
        String message = redactWithProvider(failure.getMessage() == null
            ? failure.getClass().getSimpleName()
            : failure.getMessage());
        log.error("Harness failed for ticket {}: {}", ticketId, message, failure);
        failAndRelease(ticketId, "Harness failed: " + message);
    }

    /**
     * Persist the run and claim its lease.
     *
     * Only the initial startRun failure is best-effort during rollout (unless
     * HARNESS_DURABILITY_REQUIRED=true). Once a run exists, every lease/auth
     * failure fails closed: the harness must not publish without the lease.
     */
    private boolean startDurableRun(Ticket ticket, String branchName) {
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
        if (config.isDryRun()) {
            return true;
        }

        FailureState state = failures.get(ticket.getId());
        int attempt = state == null ? 1 : Math.min(state.attempts + 1, maxAttempts);

        Map<String, Object> run;
        try {
            run = apiService.startHarnessRun(
                ticket.getId(),
                branchName,
                null,
                provider == null ? null : provider.type(),
                provider == null ? null : provider.model(),
                attempt
            );
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

        try {
            boolean leased = apiService.claimHarnessLease(
                ticket.getId(), currentRunId, leaseTtlSeconds);
            if (!leased) {
                log.warn("Ticket {} is leased by another active harness run", ticket.getId());
                finishDurableRun("failed",
                    "Ticket is leased by another active harness run", null, null);
                currentRunId = null;
                return false;
            }
        } catch (IOException | RuntimeException e) {
            log.warn("Could not claim the harness lease for ticket {}: {}",
                ticket.getId(), e.getMessage());
            finishDurableRun("failed",
                "Harness lease claim failed: " + e.getMessage(), null, null);
            currentRunId = null;
            return false;
        }

        startHeartbeat(ticket.getId());
        return true;
    }

    private void recordCheckpoint(String step, Map<String, Object> payload) {
        String runId = currentRunId;
        if (runId == null) {
            return;
        }
        try {
            apiService.checkpointHarnessRun(runId, step, payload);
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
    private boolean finishDurableRun(String status, String error, String headSha, String prUrl) {
        String runId = currentRunId;
        if (runId == null) {
            return true;
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
                return true;
            } catch (IOException | RuntimeException e) {
                lastFailure = e;
                if (attempt < 3) {
                    sleepQuietly(250L * attempt);
                }
            }
        }

        log.warn("Could not finish harness run {}: {}", runId,
            lastFailure == null ? "unknown error" : lastFailure.getMessage());
        return false;
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
        pendingTerminalStatus = "failed";
        pendingTerminalMessage = message;
        // Preserve publish evidence on the failed finish so the backend guard
        // refuses to return a pushed branch to backlog.
        pendingHeadSha = publishedHeadSha;
        pendingPrUrl = publishedPrUrl;
        releaseAfterTerminalFinish = true;

        String runId = currentRunId;
        boolean finished = finishDurableRun(
            "failed", message, publishedHeadSha, publishedPrUrl);
        if (!finished) {
            // The run/lease may still be live. The finally block retries the
            // finish and applies the backoff + release only if it succeeds.
            log.warn("Could not confirm the harness run finished for ticket {}; "
                + "deferring ticket release", ticketId);
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
        String note = " (attempt " + Math.min(attempt, maxAttempts) + "/" + maxAttempts
            + ", retry after "
            + Math.max(0, (state.nextAttemptAt - System.currentTimeMillis()) / 1000) + "s)";
        if (attempt > maxAttempts) {
            note += " — retry backoff pinned at the maximum interval; manual intervention recommended if this persists";
        }
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
        return state != null && System.currentTimeMillis() < state.nextAttemptAt;
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

        private synchronized int recordFailure(int maxAttempts, long baseDelayMs, long maxDelayMs) {
            attempts++;
            nextAttemptAt = System.currentTimeMillis()
                + retryDelayMillis(attempts, maxAttempts, baseDelayMs, maxDelayMs);
            return attempts;
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
            TicketMessage ignored = apiService.postMessage(ticketId, type, truncate(content));
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
        return body.toString();
    }

    private static String redact(String value) {
        if (value == null) {
            return "";
        }
        String redacted = value;
        String key = System.getenv("AI_API_KEY");
        if (key != null && !key.isBlank()) {
            redacted = redacted.replace(key, "[REDACTED]");
        }
        String github = System.getenv("GITHUB_TOKEN");
        if (github != null && !github.isBlank()) {
            redacted = redacted.replace(github, "[REDACTED]");
        }
        String agentKey = System.getenv("AGENT_API_KEY");
        if (agentKey != null && !agentKey.isBlank()) {
            redacted = redacted.replace(agentKey, "[REDACTED]");
        }
        return redacted;
    }

    private String redactWithProvider(String value) {
        String redacted = redact(value);
        if (provider != null && provider.hasApiKey()) {
            redacted = redacted.replace(provider.apiKey(), "[REDACTED]");
        }
        if (githubToken != null && !githubToken.isBlank()) {
            redacted = redacted.replace(githubToken, "[REDACTED]");
        }
        return redacted;
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
