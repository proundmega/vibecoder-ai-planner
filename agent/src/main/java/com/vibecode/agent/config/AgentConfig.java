package com.vibecode.agent.config;

import com.vibecode.agent.harness.HarnessConfig;
import com.vibecode.agent.harness.SandboxConfig;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;

/**
 * Agent configuration loaded from environment variables.
 * 
 * Required env vars:
 *   BACKEND_URL         - Base URL of the backend API (e.g., http://localhost:3001)
 *   AGENT_CREDENTIALS_FILE - Persistent node credential file (0600)
 *   ENROLLMENT_TOKEN    - One-time node join token (first boot only)
 *
 * Runtime env vars (set by the supervisor from the server config):
 *   AGENT_RUNTIME_ID    - Runtime id owned by this node
 *   AGENT_ROLE          - worker, reviewer or planner (closed enum)
 *   AGENT_LLM_MODEL     - `<credential-name>/<model>` resolved by the server
 *   AGENT_EFFORT        - optional override: minimal, low, medium, high or max
 *   AGENT_PROJECT_ID    - optional project hint; the backend enforces grants
 *
 * Optional env vars:
 *   REPO_OWNER/REPO_NAME - Optional build fallback; the project's configured
 *                         repository is authoritative for a worker runtime
 *   POLL_INTERVAL_MS    - Polling interval in ms (default: 30000)
 *   STALE_TIMEOUT_MS    - Stale ticket timeout in ms (default: 3600000 = 1 hour)
 *   AI_PROVIDER         - AI provider fallback when the node config is unavailable
 *   AI_MODEL            - AI model fallback (default: claude-sonnet-4-20250514)
 *   AI_API_KEY          - Dev-only provider fallback; production uses the registry
 *   AI_ENDPOINT_URL     - OpenAI-compatible endpoint URL (e.g., http://localhost:11434/v1)
 *   AI_MAX_TOKENS       - Max tokens for AI responses (default: 4096)
 *   GITHUB_AUTH_MODE    - GitHub credential mode: app (default) or pat
 *   ALLOW_PAT           - Must be true to use the PAT fallback in pat mode
 *   GITHUB_TOKEN        - Dev-only PAT fallback (never used in app mode)
 *   GIT_AUTH_MODE       - Provider-neutral alias for GITHUB_AUTH_MODE
 *   GIT_TOKEN           - Provider-neutral alias for GITHUB_TOKEN
 *   GIT_SSH_KEY_FILE    - Optional SSH key path for local/SSH providers
 *   GIT_SSH_KNOWN_HOSTS - Optional known-hosts path for local/SSH providers
 *   DRY_RUN             - If "true", don't create branches/PRs (default: false)
 *   MAX_TICKETS         - Max tickets to process per cycle (default: 1)
 *   REPO_CLONE_DIR      - Directory to clone repos into (default: /tmp/repos)
 */
public class AgentConfig {

    private String nodeId;
    private String runtimeId;
    private final String backendUrl;
    private final String enrollmentToken;
    private final String enrollmentUrl;
    private final String credentialsFile;
    private String projectId;
    private String repoOwner;
    private String repoName;
    private String role;
    private String modelRef;
    private String effort;
    private final int runtimeConcurrency;
    private final String runtimeStopFile;
    private final Duration pollInterval;
    private final Duration staleTimeout;
    private final String aiProvider;
    private final String aiModel;
    private final String aiApiKey;
    private final String aiEndpointUrl;
    private final int aiMaxTokens;
    private final boolean dryRun;
    private final int maxTicketsPerCycle;
    private final String repoCloneDir;
    private final String githubToken;
    private final String githubAuthMode;
    private final String gitSshKeyFile;
    private final String gitSshKnownHosts;
    private String repoUrl;
    private String repoBaseUrl;
    private String repoProvider = "github";
    private String repoAuthMode;
    private final boolean allowPat;
    private final HarnessConfig harnessConfig;
    private final SandboxConfig sandboxConfig;

    public AgentConfig() {
        this.backendUrl = requireEnv("BACKEND_URL");
        this.enrollmentToken = getEnv("ENROLLMENT_TOKEN", null);
        this.enrollmentUrl = getEnv("ENROLLMENT_URL", null);
        this.credentialsFile = getEnv("AGENT_CREDENTIALS_FILE", null);
        if (!hasEnrollmentSource()) {
            throw new IllegalStateException(
                "No node credentials: set ENROLLMENT_TOKEN on first boot and mount "
                    + "AGENT_CREDENTIALS_FILE on a persistent volume");
        }
        if (this.credentialsFile == null || this.credentialsFile.isBlank()) {
            throw new IllegalStateException(
                "AGENT_CREDENTIALS_FILE is required; mount a persistent volume so the "
                    + "node does not need a new join token after restart");
        }
        this.projectId = getEnv("PROJECT_ID", getEnv("AGENT_PROJECT_ID", null));
        this.repoOwner = getEnv("REPO_OWNER", null);
        this.repoName = getEnv("REPO_NAME", null);
        this.role = parseRole(getEnv("AGENT_ROLE", "worker"));
        this.runtimeId = getEnv("AGENT_RUNTIME_ID", null);
        this.modelRef = getEnv("AGENT_LLM_MODEL", null);
        this.effort = parseEffort(getEnv("AGENT_EFFORT", null));
        this.runtimeConcurrency = Math.max(1, getIntEnv("AGENT_RUNTIME_CONCURRENCY", 1));
        this.runtimeStopFile = getEnv("AGENT_RUNTIME_STOP_FILE", null);
        this.nodeId = getEnv("AGENT_NODE_ID", null);
        this.pollInterval = Duration.ofMillis(getLongEnv("POLL_INTERVAL_MS", 30000));
        this.staleTimeout = Duration.ofMillis(getLongEnv("STALE_TIMEOUT_MS", 3600000));
        this.aiProvider = getEnv("AI_PROVIDER", "claude");
        this.aiModel = getEnv("AI_MODEL", "claude-sonnet-4-20250514");
        this.aiApiKey = getEnv("AI_API_KEY", null);
        this.aiEndpointUrl = getEnv("AI_ENDPOINT_URL", "");
        this.aiMaxTokens = getIntEnv("AI_MAX_TOKENS", 4096);
        // getEnv() treats blank values as unset, so an empty GIT_* alias
        // falls back to the legacy GitHub variable.
        this.githubToken = getEnv("GIT_TOKEN", getEnv("GITHUB_TOKEN", null));
        this.githubAuthMode = getEnv("GIT_AUTH_MODE",
            getEnv("GITHUB_AUTH_MODE", "app")).toLowerCase();
        this.gitSshKeyFile = getEnv("GIT_SSH_KEY_FILE", null);
        this.gitSshKnownHosts = getEnv("GIT_SSH_KNOWN_HOSTS", null);
        if (!"app".equals(this.githubAuthMode) && !"pat".equals(this.githubAuthMode)) {
            throw new IllegalStateException(
                "GITHUB_AUTH_MODE/GIT_AUTH_MODE must be 'app' or 'pat' (got '"
                    + this.githubAuthMode + "')");
        }
        this.allowPat = "true".equalsIgnoreCase(getEnv("ALLOW_PAT", "false"));
        this.dryRun = "true".equalsIgnoreCase(getEnv("DRY_RUN", "false"));
        this.maxTicketsPerCycle = getIntEnv("MAX_TICKETS", 1);
        this.repoCloneDir = getEnv("REPO_CLONE_DIR", "/tmp/repos");
        this.harnessConfig = HarnessConfig.fromEnvironment();
        this.sandboxConfig = SandboxConfig.fromEnvironment();
        if (!isReviewMode() && hasRepoCoordinates()) {
            // Read through the getter so a test (or wrapper) can point the
            // validation at its own directory instead of the shared default.
            validateCloneDir(getRepoCloneDir());
        }
    }

    private static void validateCloneDir(String dir) {
        Path path = Paths.get(dir);
        if (!Files.exists(path)) {
            try {
                Files.createDirectories(path);
            } catch (IOException e) {
                throw new IllegalStateException(
                    "Cannot create REPO_CLONE_DIR: " + dir + " - " + describe(e));
            }
        }
        if (!Files.isDirectory(path) || !Files.isWritable(path)) {
            throw new IllegalStateException("REPO_CLONE_DIR is not writable: " + dir);
        }
        try {
            // A fixed probe name races with other agent processes and with a
            // leftover from a crashed run; a unique file only touches our own.
            Path testFile = Files.createTempFile(path, ".write-test", ".tmp");
            Files.delete(testFile);
        } catch (IOException e) {
            throw new IllegalStateException(
                "Cannot write to REPO_CLONE_DIR: " + dir + " - " + describe(e));
        }
    }

    private static String describe(IOException failure) {
        if (failure instanceof java.nio.file.FileSystemException fs && fs.getReason() != null) {
            return fs.getReason();
        }
        return failure.getClass().getSimpleName() + ": " + failure.getMessage();
    }

    public String getBackendUrl() { return backendUrl; }
    public String getEnrollmentToken() { return enrollmentToken; }
    public String getCredentialsFile() { return credentialsFile; }

    /** Node id assigned by enrollment (server-authenticated, never trusted from env). */
    public String getNodeId() { return nodeId; }

    public void setNodeId(String nodeId) { this.nodeId = nodeId; }

    /** Runtime id assigned by the supervisor/server config for this child. */
    public String getRuntimeId() { return runtimeId; }

    public void setRuntimeId(String runtimeId) { this.runtimeId = runtimeId; }

    /** Closed runtime role from the server: worker, reviewer or planner. */
    public String getRole() { return role; }

    /** Model reference declared by the supervisor/server: `<credential>/<model>`. */
    public String getModelRef() { return modelRef; }

    /** Runtime effort override; null means the model default applies. */
    public String getEffort() { return effort; }

    /** Declared concurrency for this runtime section (server-side `concurrency`). */
    public int getRuntimeConcurrency() { return runtimeConcurrency; }

    /** Marker written when the server permanently denies this runtime. */
    public String getRuntimeStopFile() { return runtimeStopFile; }

    /**
     * Fill in the runtime identity resolved from the node config when the
     * supervisor could not pass it (for example during a backend retry).
     */
    public void setRuntimeIdentity(String runtimeId, String role, String modelRef, String effort) {
        if (runtimeId != null && !runtimeId.isBlank()) {
            this.runtimeId = runtimeId;
        }
        if (role != null && !role.isBlank()) {
            this.role = parseRole(role);
        }
        if (modelRef != null && !modelRef.isBlank()) {
            this.modelRef = modelRef;
        }
        if (effort != null && !effort.isBlank()) {
            this.effort = parseEffort(effort);
        }
    }

    /** Current project hint; the backend enforces the grant, not this value. */
    public String getProjectId() { return projectId; }

    /** Set from a lease/config response; client PROJECT_ID is only a hint. */
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public boolean hasEnrollmentSource() {
        return (enrollmentToken != null && !enrollmentToken.isBlank())
            || (credentialsFile != null && !credentialsFile.isBlank());
    }

    /** Node enrollment is the only credential source after the fg-54 clean cut. */
    public boolean usesEnrollment() {
        return true;
    }

    public String getEnrollmentUrl() {
        if (enrollmentUrl != null && !enrollmentUrl.isBlank()) return enrollmentUrl;
        return getApiUrl() + "/agent-nodes/enroll";
    }

    public String getRefreshUrl() {
        String explicit = getEnv("AGENT_NODE_REFRESH_URL", null);
        if (explicit != null && !explicit.isBlank()) return explicit;
        String enroll = getEnrollmentUrl();
        return enroll.endsWith("/enroll")
            ? enroll.substring(0, enroll.length() - "/enroll".length()) + "/refresh"
            : getApiUrl() + "/agent-nodes/refresh";
    }

    public String getRepoOwner() { return repoOwner; }
    public String getRepoName() { return repoName; }

    /** Canonical repository URL from the backend; falls back to GitHub coordinates. */
    public String getRepoUrl() {
        if (repoUrl != null && !repoUrl.isBlank()) {
            String value = repoUrl.trim();
            // GitHub accepts the owner/repo shorthand; the clone needs a URL.
            if ("github".equals(repoProvider)
                && value.matches("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) {
                return "https://github.com/" + value + ".git";
            }
            return value;
        }
        if (hasRepoCoordinates()) {
            return "https://github.com/" + repoOwner + "/" + repoName + ".git";
        }
        return null;
    }

    public void setRepoUrl(String repoUrl) {
        this.repoUrl = repoUrl;
    }

    public String getRepoProvider() { return repoProvider; }

    /** Provider base URL from the backend (self-hosted hosts); null for GitHub. */
    public String getRepoBaseUrl() { return repoBaseUrl; }

    public void setRepoBaseUrl(String repoBaseUrl) {
        this.repoBaseUrl = repoBaseUrl == null || repoBaseUrl.isBlank()
            ? null
            : repoBaseUrl.trim();
    }

    public void setRepoProvider(String provider) {
        if (provider != null && !provider.isBlank()) {
            this.repoProvider = provider.trim().toLowerCase();
        }
    }

    public String getRepoAuthMode() {
        return repoAuthMode != null && !repoAuthMode.isBlank()
            ? repoAuthMode
            : githubAuthMode;
    }

    public void setRepoAuthMode(String authMode) {
        if (authMode != null && !authMode.isBlank()) {
            this.repoAuthMode = authMode.trim().toLowerCase();
        }
    }

    /** Set from the project's configured repository (server wins over env). */
    public void setRepoCoordinates(String owner, String name) {
        // Validate before mutating so a failure leaves env fallback intact.
        if (owner != null && !owner.isBlank()) {
            validateCloneDir(getRepoCloneDir());
        }
        this.repoOwner = owner;
        this.repoName = name;
    }

    public boolean hasRepoCoordinates() {
        return repoOwner != null && !repoOwner.isBlank()
            && repoName != null && !repoName.isBlank();
    }

    /** A worker may claim/build; reviewers and planners may not. */
    public boolean isBuildMode() {
        return "worker".equals(getRole());
    }

    /**
     * Review/planning runtimes do not run the build loop. The role decides
     * this; the old client-asserted mode is gone.
     */
    public boolean isReviewMode() {
        return "reviewer".equals(getRole()) || "planner".equals(getRole());
    }

    public boolean isReviewer() {
        return "reviewer".equals(getRole());
    }

    public boolean isPlanner() {
        return "planner".equals(getRole());
    }

    static String parseRole(String raw) {
        String value = raw == null ? "" : raw.trim().toLowerCase();
        if (value.isBlank()) return "worker";
        if ("worker".equals(value) || "reviewer".equals(value) || "planner".equals(value)) {
            return value;
        }
        throw new IllegalStateException(
            "AGENT_ROLE must be worker, reviewer or planner (got '" + raw + "')");
    }

    static String parseEffort(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return com.vibecode.agent.service.ProviderEffort.canonical(raw);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }
    public Duration getPollInterval() { return pollInterval; }
    public Duration getStaleTimeout() { return staleTimeout; }
    public String getAiProvider() { return aiProvider; }
    public String getAiModel() { return aiModel; }
    public String getAiApiKey() { return aiApiKey; }
    public String getAiEndpointUrl() { return aiEndpointUrl; }
    public int getAiMaxTokens() { return aiMaxTokens; }
    public boolean isDryRun() { return dryRun; }
    public int getMaxTicketsPerCycle() { return maxTicketsPerCycle; }
    public String getRepoCloneDir() { return repoCloneDir; }
    public String getGitHubToken() { return githubToken; }
    public String getGitHubAuthMode() { return githubAuthMode; }
    public String getGitAuthMode() { return githubAuthMode; }
    public String getGitToken() { return githubToken; }
    public String getGitSshKeyFile() { return gitSshKeyFile; }
    public String getGitSshKnownHosts() { return gitSshKnownHosts; }
    public boolean isAllowPat() { return allowPat; }

    public HarnessConfig getHarnessConfig() { return harnessConfig; }
    public SandboxConfig getSandboxConfig() { return sandboxConfig; }
    public String getHarnessBin() { return harnessConfig.binary(); }
    public long getHarnessStartupTimeoutMs() { return harnessConfig.startupTimeout().toMillis(); }
    public long getHarnessMaxDurationMinutes() { return harnessConfig.maxDuration().toMinutes(); }
    public java.util.List<String> getHarnessVerifyCommands() { return harnessConfig.verificationCommands(); }
    public java.util.List<String> getHarnessProtectedPaths() { return harnessConfig.protectedPaths(); }
    public String getHarnessModel() { return harnessConfig.modelOverride(); }

    public String getApiUrl() {
        return backendUrl.endsWith("/") ? backendUrl + "api/v1" : backendUrl + "/api/v1";
    }

    public String getGitHubBranchName(Long ticketId, String ticketTitle) {
        String slug = ticketTitle.toLowerCase()
            .replaceAll("[^a-z0-9]+", "-")
            .replaceAll("^-|-$", "");
        if (slug.length() > 50) {
            slug = slug.substring(0, 50);
        }
        return "vibecode/ticket-" + ticketId + "-" + slug;
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Required environment variable not set: " + name);
        }
        return value;
    }

    private static String getEnv(String name, String defaultValue) {
        String value = System.getenv(name);
        return (value != null && !value.isBlank()) ? value : defaultValue;
    }

    private static long getLongEnv(String name, long defaultValue) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) return defaultValue;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static int getIntEnv(String name, int defaultValue) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) return defaultValue;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    @Override
    public String toString() {
        return "AgentConfig{" +
            "backendUrl='" + backendUrl + '\'' +
            ", projectId='" + projectId + '\'' +
            ", repo='" + repoOwner + "/" + repoName + '\'' +
            ", aiProvider='" + aiProvider + '\'' +
            ", aiModel='" + aiModel + '\'' +
            ", aiMaxTokens=" + aiMaxTokens +
            ", dryRun=" + dryRun +
            ", maxTicketsPerCycle=" + maxTicketsPerCycle +
            ", role='" + role + '\'' +
            ", runtimeId='" + runtimeId + '\'' +
            ", modelRef='" + modelRef + '\'' +
            ", effort='" + effort + '\'' +
            ", repoCloneDir='" + repoCloneDir + '\'' +
            ", sandboxMode='" + sandboxConfig.mode() + '\'' +
            '}';
    }
}
