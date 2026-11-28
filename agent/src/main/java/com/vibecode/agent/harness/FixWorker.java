package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubTokenSource;
import com.vibecode.agent.service.WorkspaceManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Production wiring for the fix loop (fg-32c2c3b3b).
 *
 * <p>One poll cycle: list the due fix queue for this runtime's project, claim
 * the first request, build the {@link FixTicketProcessor.FixClaim} from the
 * queue row plus the ticket's acceptance criteria and planning documents, run
 * the processor with production adapters, and release the workspace. The
 * processor owns the run lifecycle (see fg-32c2c3b3a); this class only owns
 * the environment around it.</p>
 *
 * <p>Failure isolation is explicit: the build loop calls {@link #pollOnce()} and
 * must never lose a cycle because a fix attempt failed. Every error is caught
 * and logged here.</p>
 *
 * <p>The fix session needs a sandbox bridge to edit files (the built-in edit
 * tools are denied); with {@code SANDBOX_MODE=host} the worker refuses to run
 * rather than prompting a model that cannot change anything.</p>
 */
public final class FixWorker {

    private static final Logger log = LoggerFactory.getLogger(FixWorker.class);

    private static final Duration DEFAULT_CLONE_TIMEOUT = Duration.ofMinutes(10);
    private static final Duration INSTALL_TIMEOUT = Duration.ofMinutes(10);
    private static final Duration TERMINAL_TIMEOUT = Duration.ofMinutes(30);

    interface WorkspaceFactory {
        WorkspaceManager create();
    }

    interface EnvironmentFactory {
        Environment create(Path repoDir) throws IOException;
    }

    interface HarnessFactory {
        HarnessClient create(Path tempDir, SandboxBashBridge bridge) throws IOException;
    }

    /** Sandbox + bash bridge for one fix attempt, plus its verification runner. */
    interface Environment extends AutoCloseable {
        SandboxBashBridge bridge();

        List<VerificationResult> run(List<String> commands, Duration timeout);

        @Override
        void close();
    }

    private final AgentConfig config;
    private final ApiService api;
    private final ProviderSettings provider;
    private final HarnessConfig harnessConfig;
    private final String repoName;
    private final String repoUrl;
    private final String githubToken;
    private final GitHubTokenSource tokenSource;
    private final PlanningDocFetcher planningDocs;
    private final VerificationRunner verification;
    private final PublishingGuard publishingGuard;
    private final SecretLeakGuard secretLeakGuard;
    private final WorkspaceFactory workspaces;
    private final EnvironmentFactory environments;
    private final HarnessFactory harnesses;
    private final Clock clock;
    private final Set<String> completedRequests = ConcurrentHashMap.newKeySet();
    private volatile String warnedAbout;

    public FixWorker(
        AgentConfig config,
        ApiService api,
        ProviderSettings provider,
        GitHubTokenSource tokenSource,
        String githubToken,
        HarnessConfig harnessConfig,
        String repoName
    ) {
        this(
            config,
            api,
            provider,
            harnessConfig,
            repoName,
            githubToken,
            tokenSource,
            new PlanningDocFetcher(api, config),
            new VerificationRunner(harnessConfig),
            new PublishingGuard(harnessConfig.protectedPaths()),
            new SecretLeakGuard(knownSecrets(provider, githubToken)),
            defaultWorkspaces(config, tokenSource, githubToken, repoName),
            defaultEnvironments(config, harnessConfig),
            (tempDir, bridge) -> new OpenCodeClient(harnessConfig, provider, tempDir, bridge),
            Clock.systemUTC()
        );
    }

    FixWorker(
        AgentConfig config,
        ApiService api,
        ProviderSettings provider,
        HarnessConfig harnessConfig,
        String repoName,
        String githubToken,
        GitHubTokenSource tokenSource,
        PlanningDocFetcher planningDocs,
        VerificationRunner verification,
        PublishingGuard publishingGuard,
        SecretLeakGuard secretLeakGuard,
        WorkspaceFactory workspaces,
        EnvironmentFactory environments,
        HarnessFactory harnesses,
        Clock clock
    ) {
        if (config == null || api == null || harnessConfig == null) {
            throw new IllegalArgumentException("config, api and harness config are required");
        }
        this.config = config;
        this.api = api;
        this.provider = provider;
        this.harnessConfig = harnessConfig;
        this.repoName = repoName;
        this.repoUrl = config.getRepoUrl();
        this.githubToken = githubToken;
        this.tokenSource = tokenSource;
        this.planningDocs = planningDocs == null ? new PlanningDocFetcher(api, config) : planningDocs;
        this.verification = verification == null ? new VerificationRunner(harnessConfig) : verification;
        this.publishingGuard = publishingGuard == null
            ? new PublishingGuard(harnessConfig.protectedPaths())
            : publishingGuard;
        this.secretLeakGuard = secretLeakGuard == null
            ? new SecretLeakGuard(List.of())
            : secretLeakGuard;
        this.workspaces = workspaces;
        this.environments = environments;
        this.harnesses = harnesses;
        this.clock = clock == null ? Clock.systemUTC() : clock;
    }

    /**
     * Run at most one fix attempt.
     *
     * @return 1 when an attempt was started, 0 when the queue was empty, the
     *     configuration is unusable or the claim was skipped
     */
    public int pollOnce() {
        if (!config.isFixWorkerEnabled()) {
            return 0;
        }
        if (config.isDryRun()) {
            // A dry run must not call the model or claim a lease it will not
            // use; the build path skips harness execution for the same reason.
            warnOnce("dry-run", "FIX_WORKER_ENABLED is ignored in dry-run mode");
            return 0;
        }
        Long projectId = parseProjectId(config.getProjectId());
        if (projectId == null) {
            warnOnce("project", "FIX_WORKER_ENABLED is set but the runtime has no project id; "
                + "fix requests cannot be listed");
            return 0;
        }
        SandboxConfig sandboxConfig = config.getSandboxConfig() == null
            ? SandboxConfig.defaults()
            : config.getSandboxConfig();
        if (!sandboxConfig.isDocker()) {
            warnOnce("sandbox", "FIX_WORKER_ENABLED requires SANDBOX_MODE=docker: the fix "
                + "session edits files through the sandbox bridge and host mode denies it");
            return 0;
        }
        if (repoUrl == null || repoUrl.isBlank()) {
            warnOnce("repo", "FIX_WORKER_ENABLED is set but no repository URL is configured");
            return 0;
        }
        try {
            List<Map<String, Object>> queue = api.listFixQueue(projectId, 1);
            if (queue == null || queue.isEmpty()) {
                return 0;
            }
            Map<String, Object> entry = queue.get(0);
            long ticketId = longValue(entry.get("ticket_id"));
            if (ticketId <= 0) {
                log.warn("Fix queue row has no ticket id: {}", entry);
                return 0;
            }
            Map<String, Object> claimData = api.claimFix(ticketId, config.getFixLeaseSeconds());
            if (claimData == null) {
                log.info("Fix request for ticket {} is already leased by another runtime", ticketId);
                return 0;
            }
            Map<String, Object> request = mapValue(claimData.get("request"));
            if (request == null) {
                log.warn("Fix claim for ticket {} returned no request", ticketId);
                return 0;
            }
            String requestId = string(request.get("id"));
            if (requestId == null || requestId.isBlank()) {
                log.warn("Fix claim for ticket {} has no request id", ticketId);
                return 0;
            }
            if (!Boolean.TRUE.equals(claimData.get("claimed"))
                || completedRequests.contains(requestId)) {
                // A live lease owned by this runtime means our previous attempt
                // is still running or already finished. Re-running it would
                // burn a model run on a branch that no longer matches
                // reviewed_sha. Completion bookkeeping is fg-32d2.
                log.info("Fix request {} for ticket {} is already held by this runtime; "
                    + "waiting for completion", requestId, ticketId);
                return 0;
            }
            return attempt(entry, request) ? 1 : 0;
        } catch (IOException | RuntimeException error) {
            log.warn("Fix queue cycle failed: {}", safe(error));
            return 0;
        }
    }

    private boolean attempt(Map<String, Object> entry, Map<String, Object> request) {
        long ticketId = longValue(request.get("ticket_id"));
        String requestId = string(request.get("id"));
        String branch = string(request.get("branch"));
        String reviewedSha = string(request.get("reviewed_sha"));
        if (branch == null || branch.isBlank() || reviewedSha == null || reviewedSha.isBlank()) {
            log.warn("Fix request {} has no branch or reviewed SHA", requestId);
            return false;
        }
        int attempt = Math.max(0, intValue(request.get("attempts"))) + 1;
        Duration budget = Duration.ofMinutes(config.getFixMaxDurationMinutes());
        Instant deadline = clock.instant().plus(budget);
        Ticket ticket = ticket(entry, ticketId);
        FixTicketProcessor.FixClaim claim = claim(entry, request, ticketId, requestId,
            branch, reviewedSha);

        WorkspaceManager workspace = workspaces.create();
        Environment[] environment = new Environment[1];
        try {
            workspace.setWorkspaceKey(String.valueOf(ticketId));
            FixTicketProcessor processor = new FixTicketProcessor(
                workspace(workspace, deadline),
                harness(workspace, environment, deadline),
                verify(workspace, environment),
                publish(workspace),
                journal(workspace, ticketId, requestId, attempt),
                clock,
                remaining(deadline)
            );
            FixTicketProcessor.Outcome outcome = processor.process(ticket, claim);
            switch (outcome.status()) {
                case DONE -> {
                    completedRequests.add(requestId);
                    log.info("Fix attempt for ticket {} published {} ({} ms)",
                        ticketId, outcome.headSha(), outcome.durationMs());
                }
                case SKIPPED -> log.info("Fix attempt for ticket {} skipped: {}",
                    ticketId, outcome.reason());
                case FAILED -> log.warn("Fix attempt for ticket {} failed: {}",
                    ticketId, outcome.reason());
                default -> log.warn("Fix attempt for ticket {} ended as {}: {}",
                    ticketId, outcome.status(), outcome.reason());
            }
            return true;
        } catch (RuntimeException error) {
            log.warn("Fix attempt for ticket {} could not run: {}", ticketId, safe(error));
            return false;
        } finally {
            closeEnvironment(environment[0]);
            workspace.cleanup();
        }
    }

    private FixTicketProcessor.Workspace workspace(WorkspaceManager manager, Instant deadline) {
        return new FixTicketProcessor.Workspace() {
            @Override
            public Path root() {
                return manager.getRepoDir();
            }

            @Override
            public void checkout(String branch, String reviewedSha) throws IOException {
                Duration timeout = remaining(deadline);
                Duration cloneTimeout = timeout.compareTo(DEFAULT_CLONE_TIMEOUT) < 0
                    ? timeout
                    : DEFAULT_CLONE_TIMEOUT;
                manager.cloneExistingBranch(repoUrl, branch, reviewedSha, cloneTimeout);
            }
        };
    }

    /**
     * Opens the sandbox, installs dependencies, then runs the fix session. The
     * environment must exist before the prompt: the model edits files through
     * the sandbox bridge.
     */
    private FixTicketProcessor.Harness harness(
        WorkspaceManager manager,
        Environment[] reference,
        Instant deadline
    ) {
        return (root, title, prompt) -> {
            Environment environment = environments.create(manager.getRepoDir());
            reference[0] = environment;
            List<String> install = verification.resolveInstallCommands(manager.getRepoDir());
            if (!install.isEmpty()) {
                List<VerificationResult> results = environment.run(install, installTimeout(deadline));
                VerificationResult failure = firstFailure(results);
                if (failure != null) {
                    throw new IOException("dependency install failed: " + failure.command()
                        + " exited " + failure.exitCode());
                }
            }
            Path tempDir = Files.createTempDirectory("fix-harness-");
            try {
                HarnessClient client = harnesses.create(tempDir, environment.bridge());
                try {
                    new HarnessPromptRunner("fix", "fixer returned no text", terminalTimeout(deadline))
                        .run(client, root, title, prompt);
                } finally {
                    closeQuietly(client);
                }
            } finally {
                deleteQuietly(tempDir);
            }
        };
    }

    private FixTicketProcessor.Verification verify(WorkspaceManager manager, Environment[] reference) {
        return (root, timeout) -> {
            Environment environment = reference[0];
            if (environment == null) {
                throw new IOException("fix sandbox is not ready");
            }
            List<String> commands = verification.resolveCommands(manager.getRepoDir());
            if (commands.isEmpty()) {
                log.error("No verification commands were detected for the fix; refusing to publish");
                return false;
            }
            List<VerificationResult> results = environment.run(commands, timeout);
            VerificationResult failure = firstFailure(results);
            if (failure != null) {
                log.warn("Fix verification failed: {} exited {}",
                    failure.command(), failure.exitCode());
                return false;
            }
            return !results.isEmpty();
        };
    }

    /**
     * Stage, guard, commit locally, then fast-forward publish. The fg-33
     * {@code commitAndPushStaged} path is deliberately not used: it pushes with
     * a lease derived from the current head, which could overwrite a human push.
     */
    private FixTicketProcessor.Publisher publish(WorkspaceManager workspace) {
        return (message, claim) -> {
            DiffSummary diff = workspace.stageFreshDiff();
            publishingGuard.assertPublishable(diff);
            secretLeakGuard.assertClean(workspace.guardedChangedBlobs());
            String commit = workspace.commitStaged(message);
            workspace.discardStaged();
            return publishFastForward(workspace, commit, claim.branch(), claim.reviewedSha());
        };
    }

    /**
     * A push whose acknowledgement was lost is ambiguous. The fg-32c1 publish
     * is idempotent (it fetches first and returns when the head is already the
     * commit), so one retry resolves it: either the remote confirms the commit
     * or a human push wins with {@code remote_head_moved}.
     */
    private String publishFastForward(
        WorkspaceManager workspace,
        String commit,
        String branch,
        String reviewedSha
    ) throws IOException {
        try {
            return workspace.publishFastForward(commit, branch, reviewedSha);
        } catch (IOException first) {
            if (!possiblyPublished(first)) {
                throw first;
            }
            log.warn("Fix publish acknowledgement was lost; re-reading the remote: {}",
                safe(first));
            return workspace.publishFastForward(commit, branch, reviewedSha);
        }
    }

    private FixTicketProcessor.Journal journal(
        WorkspaceManager workspace,
        long ticketId,
        String requestId,
        int attempt
    ) {
        return new FixTicketProcessor.Journal() {
            @Override
            public boolean renew() throws IOException {
                return api.renewFix(ticketId, config.getFixLeaseSeconds());
            }

            @Override
            public String startRun(FixTicketProcessor.FixClaim claim) throws IOException {
                Map<String, Object> run = api.startFixHarnessRun(
                    ticketId,
                    claim.branch(),
                    String.valueOf(workspace.getRepoDir()),
                    provider == null ? null : provider.type(),
                    provider == null ? null : provider.model(),
                    attempt,
                    requestId,
                    claim.reviewedSha()
                );
                Object id = run == null ? null : run.get("id");
                return id == null ? null : String.valueOf(id);
            }

            @Override
            public void finishRun(
                String runId,
                boolean succeeded,
                String error,
                String headSha
            ) throws IOException {
                if (succeeded && headSha != null && !headSha.isBlank()) {
                    // Persist publish evidence before the terminal finish so a
                    // lost finish response can be adopted by fg-33 recovery.
                    api.recordHarnessPublish(runId, headSha, null);
                }
                api.finishHarnessRun(
                    runId,
                    succeeded ? "succeeded" : "failed",
                    error,
                    headSha,
                    null
                );
            }
        };
    }

    private FixTicketProcessor.FixClaim claim(
        Map<String, Object> entry,
        Map<String, Object> request,
        long ticketId,
        String requestId,
        String branch,
        String reviewedSha
    ) {
        return new FixTicketProcessor.FixClaim(
            requestId,
            ticketId,
            branch,
            reviewedSha,
            intValue(entry.get("review_round")),
            findings(entry.get("findings")),
            string(request.get("feedback")),
            harnessConfig.verificationCommands() == null
                ? List.of() : harnessConfig.verificationCommands(),
            List.of(),
            null,
            acceptanceCriteria(ticketId),
            planningDocuments(ticketId)
        );
    }

    private List<String> acceptanceCriteria(long ticketId) {
        try {
            List<String> criteria = api.listAcceptanceCriteria(ticketId);
            return criteria == null ? List.of() : criteria;
        } catch (IOException | RuntimeException error) {
            log.warn("Could not fetch acceptance criteria for ticket {}: {}",
                ticketId, safe(error));
            return List.of();
        }
    }

    private List<String> planningDocuments(long ticketId) {
        try {
            List<String> docs = planningDocs.fetch(ticketId);
            return docs == null ? List.of() : docs;
        } catch (RuntimeException error) {
            log.warn("Could not fetch planning documents for ticket {}: {}",
                ticketId, safe(error));
            return List.of();
        }
    }

    static List<PromptBuilder.FixFinding> findings(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<PromptBuilder.FixFinding> findings = new ArrayList<>();
        int index = 0;
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) {
                continue;
            }
            index++;
            Object id = map.get("finding_key");
            String findingId = id == null || String.valueOf(id).isBlank()
                ? "F" + index
                : String.valueOf(id);
            findings.add(new PromptBuilder.FixFinding(
                findingId,
                text(map.get("severity")),
                text(map.get("file")),
                integer(map.get("line")),
                text(map.get("message")),
                text(map.get("suggestion"))
            ));
        }
        return findings;
    }

    static Ticket ticket(Map<String, Object> entry, long ticketId) {
        Ticket ticket = new Ticket();
        ticket.setId(ticketId);
        ticket.setTitle(text(entry.get("title")));
        ticket.setDescription(text(entry.get("description")));
        ticket.setStatus(text(entry.get("status")));
        ticket.setPrUrl(text(entry.get("pr_url")));
        return ticket;
    }

    private Duration installTimeout(Instant deadline) {
        Duration left = remaining(deadline);
        return left.compareTo(INSTALL_TIMEOUT) < 0 ? left : INSTALL_TIMEOUT;
    }

    private Duration terminalTimeout(Instant deadline) {
        Duration left = remaining(deadline);
        return left.compareTo(TERMINAL_TIMEOUT) < 0 ? left : TERMINAL_TIMEOUT;
    }

    private Duration remaining(Instant deadline) {
        Duration left = Duration.between(clock.instant(), deadline);
        if (left.isNegative() || left.isZero()) {
            return Duration.ofSeconds(1);
        }
        return left;
    }

    private static VerificationResult firstFailure(List<VerificationResult> results) {
        if (results == null || results.isEmpty()) {
            return null;
        }
        for (VerificationResult result : results) {
            if (!result.passed()) {
                return result;
            }
        }
        return null;
    }

    static boolean possiblyPublished(IOException error) {
        return error != null && error.getMessage() != null
            && error.getMessage().contains("possibly_published");
    }

    private static WorkspaceFactory defaultWorkspaces(
        AgentConfig config,
        GitHubTokenSource tokenSource,
        String githubToken,
        String repoName
    ) {
        return () -> {
            WorkspaceManager manager = new WorkspaceManager(
                config.getRepoCloneDir(), repoName, config.isDryRun(), githubToken,
                tokenSource, null, tokenOrigin(config));
            manager.setLocalRepoRoot(config.getLocalRepoRoot());
            return manager;
        };
    }

    private static EnvironmentFactory defaultEnvironments(
        AgentConfig config,
        HarnessConfig harnessConfig
    ) {
        SandboxConfig sandboxConfig = config.getSandboxConfig() == null
            ? SandboxConfig.defaults()
            : config.getSandboxConfig();
        SandboxRunner runner = SandboxRunnerFactory.create(sandboxConfig);
        VerificationRunner verification = new VerificationRunner(harnessConfig);
        return repoDir -> DockerEnvironment.open(runner, sandboxConfig, repoDir, verification);
    }

    private static final class DockerEnvironment implements Environment {

        private final SandboxHandle handle;
        private final SandboxBashBridge bridge;
        private final SandboxRunner runner;
        private final VerificationRunner verification;

        private DockerEnvironment(
            SandboxRunner runner,
            SandboxHandle handle,
            SandboxBashBridge bridge,
            VerificationRunner verification
        ) {
            this.runner = runner;
            this.handle = handle;
            this.bridge = bridge;
            this.verification = verification;
        }

        static DockerEnvironment open(
            SandboxRunner runner,
            SandboxConfig config,
            Path repoDir,
            VerificationRunner verification
        ) throws IOException {
            SandboxHandle handle = null;
            SandboxBashBridge bridge = null;
            try {
                handle = runner.create(config.specFor(repoDir));
                bridge = new SandboxBashBridge(runner, handle, repoDir, config.execTimeout());
                bridge.start();
                return new DockerEnvironment(runner, handle, bridge, verification);
            } catch (IOException | RuntimeException error) {
                if (bridge != null) {
                    coverQuietly(bridge);
                }
                if (handle != null) {
                    destroyQuietly(runner, handle);
                }
                throw error instanceof IOException io
                    ? io
                    : new IOException("Could not start the fix sandbox: " + error.getMessage(), error);
            }
        }

        @Override
        public SandboxBashBridge bridge() {
            return bridge;
        }

        @Override
        public List<VerificationResult> run(List<String> commands, Duration timeout) {
            return verification.run(runner, handle, commands, timeout);
        }

        @Override
        public void close() {
            coverQuietly(bridge);
            destroyQuietly(runner, handle);
        }
    }

    private static void coverQuietly(SandboxBashBridge bridge) {
        try {
            bridge.close();
        } catch (RuntimeException error) {
            log.warn("Could not close the fix sandbox bridge: {}", error.getMessage());
        }
    }

    private static void destroyQuietly(SandboxRunner runner, SandboxHandle handle) {
        try {
            runner.destroy(handle);
        } catch (IOException | RuntimeException error) {
            log.warn("Could not destroy the fix sandbox: {}", error.getMessage());
        }
    }

    private void closeEnvironment(Environment environment) {
        if (environment == null) {
            return;
        }
        try {
            environment.close();
        } catch (RuntimeException error) {
            log.warn("Could not close the fix environment: {}", error.getMessage());
        }
    }

    private static void closeQuietly(HarnessClient client) {
        try {
            client.close();
        } catch (RuntimeException error) {
            log.warn("Could not close the fix harness: {}", error.getMessage());
        }
    }

    private static void deleteQuietly(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException error) {
            log.debug("Could not delete {}: {}", path, error.getMessage());
        }
    }

    private void warnOnce(String key, String message) {
        if (key.equals(warnedAbout)) {
            return;
        }
        warnedAbout = key;
        log.warn(message);
    }

    static String tokenOrigin(AgentConfig config) {
        String base = config.getRepoBaseUrl();
        return base != null && !base.isBlank() ? base : config.getRepoUrl();
    }

    private static List<String> knownSecrets(ProviderSettings provider, String githubToken) {
        List<String> secrets = new ArrayList<>();
        if (provider != null) {
            secrets.add(provider.apiKey());
        }
        secrets.add(githubToken);
        return secrets;
    }

    private static Long parseProjectId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = Long.parseLong(raw.trim());
            return value > 0 ? value : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static Map<String, Object> mapValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) map;
            return typed;
        }
        return null;
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String text(Object value) {
        String text = string(value);
        return text == null || text.isBlank() ? null : text;
    }

    private static long longValue(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        try {
            return value == null ? 0L : Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException error) {
            return 0L;
        }
    }

    private static int intValue(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return value == null ? 0 : Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private static Integer integer(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.valueOf(String.valueOf(value));
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static String safe(Throwable error) {
        if (error == null) {
            return "unknown error";
        }
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}
