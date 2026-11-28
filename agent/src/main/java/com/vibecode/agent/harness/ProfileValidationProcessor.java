package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubTokenSource;
import com.vibecode.agent.service.WorkspaceManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Executes admin-triggered repo-profile dry runs (fg-39 FR9).
 *
 * <p>The worker clones the repository, applies the profile image/env/cache to
 * the same sandbox the ticket path uses, runs setup and verification, and
 * reports bounded, redacted output. It never starts a model session and never
 * publishes a branch or PR.</p>
 */
public class ProfileValidationProcessor {

    private static final Logger log = LoggerFactory.getLogger(ProfileValidationProcessor.class);

    private final AgentConfig config;
    private final ApiService apiService;
    private final SandboxConfig sandboxConfig;
    private final SandboxRunner sandboxRunner;
    private final Function<String, WorkspaceManager> workspaceFactory;
    private final VerificationRunner verificationRunner;

    public ProfileValidationProcessor(
        AgentConfig config,
        ApiService apiService,
        SandboxConfig sandboxConfig,
        SandboxRunner sandboxRunner,
        GitHubTokenSource tokenSource,
        String githubToken
    ) {
        this(
            config,
            apiService,
            sandboxConfig,
            sandboxRunner,
            repoName -> {
                WorkspaceManager manager = new WorkspaceManager(
                    config.getRepoCloneDir(), repoName, config.isDryRun(),
                    githubToken, tokenSource, null,
                    HarnessTicketProcessor.tokenOrigin(config));
                manager.setLocalRepoRoot(config.getLocalRepoRoot());
                return manager;
            },
            new VerificationRunner()
        );
    }

    ProfileValidationProcessor(
        AgentConfig config,
        ApiService apiService,
        SandboxConfig sandboxConfig,
        SandboxRunner sandboxRunner,
        Function<String, WorkspaceManager> workspaceFactory,
        VerificationRunner verificationRunner
    ) {
        this.config = config;
        this.apiService = apiService;
        this.sandboxConfig = sandboxConfig == null ? SandboxConfig.defaults() : sandboxConfig;
        this.sandboxRunner = sandboxRunner == null ? SandboxRunnerFactory.hostOnly() : sandboxRunner;
        this.workspaceFactory = workspaceFactory;
        this.verificationRunner = verificationRunner == null
            ? new VerificationRunner()
            : verificationRunner;
    }

    /**
     * Claim and run one queued validation. Called from the agent poll loop;
     * sequential execution is intentional, just like ticket processing.
     */
    public void pollOnce() {
        String projectId = config.getProjectId();
        if (projectId == null || projectId.isBlank() || config.isDryRun()) {
            return;
        }
        RepoProfileValidation validation;
        try {
            validation = apiService.claimRepoProfileValidation(projectId);
        } catch (IOException e) {
            log.warn("Could not claim a repo-profile validation: {}", e.getMessage());
            return;
        }
        if (validation == null) {
            return;
        }
        try {
            validation.validateProfile();
        } catch (IllegalArgumentException e) {
            reportFailed(projectId, validation, "Invalid repo profile: " + e.getMessage());
            return;
        }
        runValidation(projectId, validation);
    }

    private void runValidation(String projectId, RepoProfileValidation validation) {
        RepoProfile profile = validation.profile();
        String repoUrl;
        try {
            repoUrl = resolveRepoUrl(profile);
        } catch (RuntimeException e) {
            reportFailed(projectId, validation,
                "Profile repository binding failed: " + e.getMessage());
            return;
        }
        if (repoUrl == null || repoUrl.isBlank()) {
            reportFailed(projectId, validation,
                "No repo_url in the profile and REPO_OWNER/REPO_NAME are not configured");
            return;
        }

        WorkspaceManager workspace = null;
        SandboxHandle sandbox = null;
        long started = System.nanoTime();
        Instant deadline = Instant.now().plus(Duration.ofMinutes(profile.maxRoundMinutes()));
        try {
            workspace = workspaceFactory.apply(repoName(repoUrl));
            String branch = "vibecode/profile-validate-" + validation.id()
                .replace("-", "").substring(0, 8);
            Duration cloneTimeout = phaseTimeout(profile.timeouts().setupMinutes(), deadline);
            if (cloneTimeout.isZero()) {
                reportFailed(projectId, validation,
                    "The profile validation budget was exhausted before clone");
                return;
            }
            workspace.cloneRepo(repoUrl, branch, profile.baseBranch(), cloneTimeout);
            if (Instant.now().isAfter(deadline)) {
                reportFailed(projectId, validation,
                    "The profile validation budget was exhausted after clone");
                return;
            }

            SandboxConfig effective = sandboxConfig;
            if (sandboxConfig.isDocker()) {
                effective = sandboxConfig.withRepoProfile(
                    profile, projectId, validation.profileVersion(),
                    workspace.getRepoDir(), workspace.getCacheDir());
                if (profile.egress() != null && profile.egress().mtls() != null) {
                    EgressMtlsMaterial material = apiService.getRepoProfileMtls(
                        projectId,
                        validation.profileId(),
                        validation.profileVersion(),
                        profile.egress().mtls().credentialId());
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
                    effective = effective.withEgressMtls(material);
                }
                sandbox = sandboxRunner.create(effective.specFor(workspace.getRepoDir()));
                if (Instant.now().isAfter(deadline)) {
                    throw new IllegalStateException(
                        "The profile validation budget was exhausted during sandbox setup");
                }
            } else if (!profile.services().isEmpty()) {
                reportFailed(projectId, validation,
                    "The profile declares services, but host mode cannot provide them. "
                        + "Set SANDBOX_MODE=docker.");
                return;
            } else if (profile.image() != null || !profile.caches().isEmpty()
                || profile.egress() != null) {
                log.warn("Repo profile image/caches/egress are ignored in host mode; "
                    + "enable SANDBOX_MODE=docker to use them");
            }

            Map<String, String> environment = effective.isDocker()
                ? profile.environment()
                : profile.env();
            List<Map<String, Object>> commands = new ArrayList<>();
            boolean succeeded = runPhase(
                workspace, sandbox, "setup", profile.setup(),
                phaseTimeout(profile.timeouts().setupMinutes(), deadline),
                environment, commands, VerificationRunner.FlakyPolicy.none());
            boolean cleanupConfigured = !profile.testData().cleanup().isEmpty();
            if (succeeded && !profile.testData().setup().isEmpty()) {
                succeeded = runPhase(
                    workspace, sandbox, "test_data_setup", profile.testData().setup(),
                    phaseTimeout(profile.timeouts().setupMinutes(), deadline),
                    environment, commands, VerificationRunner.FlakyPolicy.none());
            }
            if (succeeded) {
                succeeded = runPhase(
                    workspace, sandbox, "verify", profile.verify(),
                    phaseTimeout(profile.timeouts().verifyMinutes(), deadline),
                    environment, commands, flakyPolicy(profile));
            } else {
                commands.add(Map.of(
                    "phase", "verify",
                    "skipped", true,
                    "reason", "setup or test-data setup failed"
                ));
            }
            if (cleanupConfigured) {
                boolean cleanupOk = runPhase(
                    workspace, sandbox, "test_data_cleanup", profile.testData().cleanup(),
                    phaseTimeout(profile.timeouts().verifyMinutes(), deadline),
                    environment, commands, VerificationRunner.FlakyPolicy.none());
                succeeded = succeeded && cleanupOk;
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("sandboxMode", effective.mode().value());
            result.put("durationMs", Duration.ofNanos(System.nanoTime() - started).toMillis());
            if (workspace.getBaseCommit() != null) {
                result.put("baseSha", workspace.getBaseCommit());
            }
            result.put("commands", commands);
            // Destroy before reporting success: destroy() fails closed when a
            // service container or network remains, and a validation that
            // leaks resources must not become activatable.
            if (sandbox != null) {
                try {
                    sandboxRunner.destroy(sandbox);
                    sandbox = null;
                } catch (IOException | RuntimeException e) {
                    reportFailed(projectId, validation,
                        "Profile validation cleanup failed: " + e.getMessage());
                    return;
                }
            }
            report(projectId, validation, succeeded ? "succeeded" : "failed", result,
                succeeded ? null : "profile setup or verification failed");
        } catch (IOException | RuntimeException e) {
            reportFailed(projectId, validation,
                "Profile validation failed: " + e.getMessage());
        } finally {
            if (sandbox != null) {
                try {
                    sandboxRunner.destroy(sandbox);
                } catch (IOException | RuntimeException e) {
                    log.warn("Could not destroy validation sandbox: {}", e.getMessage());
                }
            }
            if (workspace != null) {
                try {
                    workspace.cleanup();
                } catch (RuntimeException e) {
                    log.warn("Could not clean up validation workspace: {}", e.getMessage());
                }
            }
        }
    }

    private static Duration phaseTimeout(int requestedMinutes, Instant deadline) {
        long remainingMs = Duration.between(Instant.now(), deadline).toMillis();
        if (remainingMs <= 0) {
            return Duration.ZERO;
        }
        return Duration.ofMillis(Math.min(
            Math.max(1, requestedMinutes) * 60_000L, remainingMs));
    }

    private boolean runPhase(
        WorkspaceManager workspace,
        SandboxHandle sandbox,
        String phase,
        List<String> commands,
        Duration timeout,
        Map<String, String> environment,
        List<Map<String, Object>> results,
        VerificationRunner.FlakyPolicy flakyPolicy
    ) {
        if (commands == null || commands.isEmpty()) {
            return true;
        }
        if (timeout == null || timeout.isNegative() || timeout.isZero()) {
            results.add(Map.of(
                "phase", phase,
                "error", "timeout budget exhausted"
            ));
            return false;
        }
        long started = System.nanoTime();
        VerificationRunner.FlakyPolicy policy = flakyPolicy == null
            ? VerificationRunner.FlakyPolicy.none()
            : flakyPolicy;
        List<VerificationResult> phaseResults;
        if (sandbox != null) {
            phaseResults = policy.enabled()
                ? verificationRunner.run(sandboxRunner, sandbox, commands, timeout, policy)
                : verificationRunner.run(sandboxRunner, sandbox, commands, timeout);
        } else {
            phaseResults = policy.enabled()
                ? verificationRunner.run(
                    workspace.getRepoDir(), commands, timeout, environment, policy)
                : verificationRunner.run(
                    workspace.getRepoDir(), commands, timeout, environment);
        }
        long durationMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
        boolean passed = true;
        for (VerificationResult result : phaseResults) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("phase", phase);
            entry.put("command", RedactionRegistry.redact(result.command()));
            entry.put("exitCode", result.exitCode());
            entry.put("timedOut", result.timedOut());
            entry.put("attempts", result.attempts());
            entry.put("flaky", result.flaky());
            entry.put("output", RedactionRegistry.redact(result.output()));
            entry.put("durationMs", durationMs);
            results.add(entry);
            passed = passed && result.passed();
        }
        return passed;
    }

    private static VerificationRunner.FlakyPolicy flakyPolicy(RepoProfile profile) {
        if (profile == null) {
            return VerificationRunner.FlakyPolicy.none();
        }
        return new VerificationRunner.FlakyPolicy(profile.flakyTests(), profile.flakyRetries());
    }

    private void reportFailed(
        String projectId,
        RepoProfileValidation validation,
        String message
    ) {
        String safe = RedactionRegistry.redact(message);
        log.warn("Repo-profile validation {} failed: {}", validation.id(), safe);
        report(projectId, validation, "failed", Map.of(), safe);
    }

    private void report(
        String projectId,
        RepoProfileValidation validation,
        String status,
        Map<String, Object> result,
        String error
    ) {
        try {
            apiService.finishRepoProfileValidation(
                projectId, validation.id(), status, result,
                error == null ? null : RedactionRegistry.redact(error));
        } catch (IOException | RuntimeException e) {
            log.warn("Could not report repo-profile validation {}: {}",
                validation.id(), e.getMessage());
        }
    }

    private String resolveRepoUrl(RepoProfile profile) {
        String configured = null;
        if (config.getRepoOwner() != null && !config.getRepoOwner().isBlank()
            && config.getRepoName() != null && !config.getRepoName().isBlank()) {
            configured = "https://github.com/" + config.getRepoOwner() + "/"
                + config.getRepoName() + ".git";
        }
        if (configured == null) {
            return profile.repoUrl();
        }
        if (profile.repoUrl() != null && !profile.repoUrl().isBlank()
            && !normalizeRepoUrl(profile.repoUrl()).equals(normalizeRepoUrl(configured))) {
            throw new IllegalArgumentException(
                "profile repo_url does not match REPO_OWNER/REPO_NAME");
        }
        return configured;
    }

    private static String normalizeRepoUrl(String value) {
        return String.valueOf(value).trim()
            .replaceAll("\\.git$", "")
            .replaceAll("/+$", "")
            .toLowerCase(java.util.Locale.ROOT);
    }

    private static String repoName(String repoUrl) {
        String value = repoUrl.endsWith(".git")
            ? repoUrl.substring(0, repoUrl.length() - 4)
            : repoUrl;
        int slash = value.lastIndexOf('/');
        String name = slash >= 0 ? value.substring(slash + 1) : value;
        return name.replaceAll("[^A-Za-z0-9._-]", "-");
    }
}
