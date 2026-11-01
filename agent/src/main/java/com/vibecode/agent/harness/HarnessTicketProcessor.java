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
    private final int maxAttempts = intEnv("HARNESS_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
    private final long retryBaseDelayMs = longEnv("HARNESS_RETRY_BASE_DELAY_MS", DEFAULT_RETRY_BASE_DELAY_MS);
    private final long retryMaxDelayMs = longEnv("HARNESS_RETRY_MAX_DELAY_MS", DEFAULT_RETRY_MAX_DELAY_MS);

    private volatile String currentTicketId;
    private volatile String currentStep;

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

        WorkspaceManager workspace = null;
        HarnessClient harness = null;
        Path tempDir = null;

        try {
            List<String> planningDocs = planningDocFetcher.fetch(pickedUp.getId());
            if (planningDocs == null) {
                planningDocs = List.of();
            }
            log.info("Fetched {} planning documents", planningDocs.size());

            String branchName = config.getGitHubBranchName(pickedUp.getId(), pickedUp.getTitle());
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
            if (!verification.isEmpty()) {
                postMessage(pickedUp.getId(), "update", verificationSummary(verification));
            }

            List<VerificationResult> verifyFailures = failures(verifyResults);
            if (!verifyFailures.isEmpty()) {
                failAndRelease(pickedUp.getId(),
                    "Verification failed; not publishing.\n\n" + failureDetails(verifyFailures));
                return;
            }

            currentStep = "publishing";
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
                String commitSha = workspace.commitAndPushStaged(
                    "feat: " + pickedUp.getTitle(), branchName);
                String prUrl = gitHubService.createPullRequest(
                    "feat: " + pickedUp.getTitle(),
                    buildPrBody(pickedUp, branchName, commitSha, diff, verification),
                    branchName,
                    "main"
                );

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
                try {
                    apiService.updateTicketStatus(pickedUp.getId(), "review");
                } catch (IOException | RuntimeException e) {
                    log.warn("Push/PR succeeded but updating ticket {} status failed: {}",
                        pickedUp.getId(), e.getMessage());
                }
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
            closeQuietly(harness);
            deleteQuietly(tempDir);
            if (workspace != null) {
                workspace.cleanup();
            }
            currentTicketId = null;
            currentStep = null;
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
     * Post a failure and release the ticket with exponential backoff. Without
     * this, the poll loop re-picks the same ticket every 30 seconds and runs
     * another multi-minute harness.
     */
    private void failAndRelease(Long ticketId, String message) {
        FailureState state = failures.computeIfAbsent(ticketId, ignored -> new FailureState());
        int attempt = state.recordFailure(maxAttempts, retryBaseDelayMs, retryMaxDelayMs);
        String note = " (attempt " + Math.min(attempt, maxAttempts) + "/" + maxAttempts
            + ", retry after "
            + Math.max(0, (state.nextAttemptAt - System.currentTimeMillis()) / 1000) + "s)";
        if (attempt > maxAttempts) {
            note += " — maximum retries reached; manual intervention recommended";
        }
        postMessage(ticketId, "update", message + note);
        release(ticketId);
    }

    private boolean isBackingOff(Long ticketId) {
        FailureState state = failures.get(ticketId);
        return state != null && System.currentTimeMillis() < state.nextAttemptAt;
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

    private static final class FailureState {
        private int attempts;
        private long nextAttemptAt;

        private synchronized int recordFailure(int maxAttempts, long baseDelayMs, long maxDelayMs) {
            attempts++;
            long exponent = Math.min(attempts - 1, 10);
            long delay = Math.min(maxDelayMs, baseDelayMs * (1L << exponent));
            if (attempts >= maxAttempts) {
                delay = maxDelayMs;
            }
            nextAttemptAt = System.currentTimeMillis() + Math.max(0, delay);
            return attempts;
        }
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
