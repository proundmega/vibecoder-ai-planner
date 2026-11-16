package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubTokenSource;
import com.vibecode.agent.service.WorkspaceManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.Duration;
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
            repoName -> new WorkspaceManager(
                config.getRepoCloneDir(), repoName, config.isDryRun(),
                githubToken, tokenSource),
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
        String repoUrl = resolveRepoUrl(profile);
        if (repoUrl == null || repoUrl.isBlank()) {
            reportFailed(projectId, validation,
                "No repo_url in the profile and REPO_OWNER/REPO_NAME are not configured");
            return;
        }

        WorkspaceManager workspace = null;
        SandboxHandle sandbox = null;
        long started = System.nanoTime();
        try {
            workspace = workspaceFactory.apply(repoName(repoUrl));
            String branch = "vibecode/profile-validate-" + validation.id()
                .replace("-", "").substring(0, 8);
            workspace.cloneRepo(repoUrl, branch, profile.baseBranch());

            SandboxConfig effective = sandboxConfig;
            if (sandboxConfig.isDocker()) {
                effective = sandboxConfig.withRepoProfile(
                    profile, projectId, validation.profileVersion());
                sandbox = sandboxRunner.create(effective.specFor(workspace.getRepoDir()));
            } else if (!profile.caches().isEmpty()) {
                log.warn("Profile caches are ignored in host mode; "
                    + "enable SANDBOX_MODE=docker to use the cache volume");
            }

            Map<String, String> environment = effective.isDocker()
                ? profile.environment()
                : profile.env();
            List<Map<String, Object>> commands = new ArrayList<>();
            boolean succeeded = runPhase(
                workspace, sandbox, "setup", profile.setup(),
                Duration.ofMinutes(profile.timeouts().setupMinutes()),
                environment, commands);
            if (succeeded) {
                succeeded = runPhase(
                    workspace, sandbox, "verify", profile.verify(),
                    Duration.ofMinutes(profile.timeouts().verifyMinutes()),
                    environment, commands);
            } else {
                commands.add(Map.of(
                    "phase", "verify",
                    "skipped", true,
                    "reason", "setup failed"
                ));
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("sandboxMode", effective.mode().value());
            result.put("cacheVolume", effective.cacheVolume() == null ? "" : effective.cacheVolume());
            result.put("durationMs", Duration.ofNanos(System.nanoTime() - started).toMillis());
            if (workspace.getBaseCommit() != null) {
                result.put("baseSha", workspace.getBaseCommit());
            }
            result.put("commands", commands);
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

    private boolean runPhase(
        WorkspaceManager workspace,
        SandboxHandle sandbox,
        String phase,
        List<String> commands,
        Duration timeout,
        Map<String, String> environment,
        List<Map<String, Object>> results
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
        List<VerificationResult> phaseResults;
        if (sandbox != null) {
            phaseResults = verificationRunner.run(
                sandboxRunner, sandbox, commands, timeout);
        } else {
            phaseResults = verificationRunner.run(
                workspace.getRepoDir(), commands, timeout, environment);
        }
        long durationMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
        boolean passed = true;
        for (VerificationResult result : phaseResults) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("phase", phase);
            entry.put("command", result.command());
            entry.put("exitCode", result.exitCode());
            entry.put("timedOut", result.timedOut());
            entry.put("output", result.output());
            entry.put("durationMs", durationMs);
            results.add(entry);
            passed = passed && result.passed();
        }
        return passed;
    }

    private void reportFailed(
        String projectId,
        RepoProfileValidation validation,
        String message
    ) {
        log.warn("Repo-profile validation {} failed: {}", validation.id(), message);
        report(projectId, validation, "failed", Map.of(), message);
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
                projectId, validation.id(), status, result, error);
        } catch (IOException | RuntimeException e) {
            log.warn("Could not report repo-profile validation {}: {}",
                validation.id(), e.getMessage());
        }
    }

    private String resolveRepoUrl(RepoProfile profile) {
        if (profile.repoUrl() != null && !profile.repoUrl().isBlank()) {
            return profile.repoUrl();
        }
        if (config.getRepoOwner() == null || config.getRepoOwner().isBlank()
            || config.getRepoName() == null || config.getRepoName().isBlank()) {
            return null;
        }
        return "https://github.com/" + config.getRepoOwner() + "/"
            + config.getRepoName() + ".git";
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
