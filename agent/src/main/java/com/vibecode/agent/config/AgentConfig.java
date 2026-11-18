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
 *   AGENT_API_KEY      - API key for backend authentication
 *   BACKEND_URL         - Base URL of the backend API (e.g., http://localhost:3001)
 *   PROJECT_ID          - Project ID to work on
 *   REPO_OWNER          - GitHub repository owner
 *   REPO_NAME           - GitHub repository name
 * 
 * Optional env vars:
 *   POLL_INTERVAL_MS    - Polling interval in ms (default: 30000)
 *   STALE_TIMEOUT_MS    - Stale ticket timeout in ms (default: 3600000 = 1 hour)
 *   AI_PROVIDER         - AI provider to use: claude, anthropic, openai, opencode,
 *                         opencode-go, generic, custom, ollama, vllm or llamacpp
 *                         (default: claude)
 *   AI_MODEL            - AI model name (default: claude-sonnet-4-20250514)
 *   AI_API_KEY          - AI provider API key (falls back to env if not in DB)
 *   AI_ENDPOINT_URL     - OpenAI-compatible endpoint URL (e.g., http://localhost:11434/v1)
 *   AI_MAX_TOKENS       - Max tokens for AI responses (default: 4096)
 *   GITHUB_AUTH_MODE    - GitHub credential mode: app (default) or pat
 *   ALLOW_PAT           - Must be true to use the PAT fallback in pat mode
 *   GITHUB_TOKEN        - Dev-only PAT fallback (never used in app mode)
 *   DRY_RUN             - If "true", don't create branches/PRs (default: false)
 *   MAX_TICKETS         - Max tickets to process per cycle (default: 1)
 *   REPO_CLONE_DIR      - Directory to clone repos into (default: /tmp/repos)
 */
public class AgentConfig {

    private final String agentApiKey;
    private String agentId;
    private final String backendUrl;
    private final String enrollmentToken;
    private final String enrollmentUrl;
    private final String credentialsFile;
    private final String agentAuthMode;
    private String projectId;
    private final String repoOwner;
    private final String repoName;
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
    private final boolean allowPat;
    private final HarnessConfig harnessConfig;
    private final SandboxConfig sandboxConfig;

    public AgentConfig() {
        this.agentApiKey = getEnv("AGENT_API_KEY", null);
        this.agentId = getEnv("AGENT_ID", null);
        this.backendUrl = requireEnv("BACKEND_URL");
        this.enrollmentToken = getEnv("ENROLLMENT_TOKEN", null);
        this.enrollmentUrl = getEnv("ENROLLMENT_URL", null);
        this.credentialsFile = getEnv("AGENT_CREDENTIALS_FILE", null);
        this.agentAuthMode = getEnv("AGENT_AUTH_MODE", "auto").toLowerCase();
        if (!"auto".equals(this.agentAuthMode)
                && !"enroll".equals(this.agentAuthMode)
                && !"legacy".equals(this.agentAuthMode)) {
            throw new IllegalStateException(
                "AGENT_AUTH_MODE must be 'auto', 'enroll' or 'legacy' (got '" + this.agentAuthMode + "')");
        }
        if (!staticCredentialsConfigured() && !hasEnrollmentSource()) {
            throw new IllegalStateException(
                "No agent credentials: set AGENT_ID + AGENT_API_KEY, or ENROLLMENT_TOKEN "
                    + "(with optional AGENT_CREDENTIALS_FILE)");
        }
        if ("legacy".equals(this.agentAuthMode) && !staticCredentialsConfigured()) {
            throw new IllegalStateException(
                "AGENT_AUTH_MODE=legacy requires AGENT_ID and AGENT_API_KEY");
        }
        this.projectId = getEnv("PROJECT_ID", null);
        // Compute from the just-read fields (not the overridable method) so a
        // test/subclass cannot change validation mid-construction.
        boolean enrollmentMode = shouldEnroll(
            this.agentAuthMode, staticCredentialsConfigured(), hasEnrollmentSource());
        if (!enrollmentMode && (this.projectId == null || this.projectId.isBlank())) {
            throw new IllegalStateException(
                "PROJECT_ID is required for static credentials (enrollment reads the project from the server)");
        }
        if (enrollmentMode && (this.credentialsFile == null || this.credentialsFile.isBlank())) {
            throw new IllegalStateException(
                "AGENT_CREDENTIALS_FILE is required in enrollment mode; mount a persistent volume "
                    + "so the node does not need a new join token after restart");
        }
        this.repoOwner = getEnv("REPO_OWNER", null);
        this.repoName = getEnv("REPO_NAME", null);
        this.pollInterval = Duration.ofMillis(getLongEnv("POLL_INTERVAL_MS", 30000));
        this.staleTimeout = Duration.ofMillis(getLongEnv("STALE_TIMEOUT_MS", 3600000));
        this.aiProvider = getEnv("AI_PROVIDER", "claude");
        this.aiModel = getEnv("AI_MODEL", "claude-sonnet-4-20250514");
        this.aiApiKey = getEnv("AI_API_KEY", null);
        this.aiEndpointUrl = getEnv("AI_ENDPOINT_URL", "");
        this.aiMaxTokens = getIntEnv("AI_MAX_TOKENS", 4096);
        this.githubToken = getEnv("GITHUB_TOKEN", null);
        this.githubAuthMode = getEnv("GITHUB_AUTH_MODE", "app").toLowerCase();
        if (!"app".equals(this.githubAuthMode) && !"pat".equals(this.githubAuthMode)) {
            throw new IllegalStateException(
                "GITHUB_AUTH_MODE must be 'app' or 'pat' (got '" + this.githubAuthMode + "')");
        }
        this.allowPat = "true".equalsIgnoreCase(getEnv("ALLOW_PAT", "false"));
        this.dryRun = "true".equalsIgnoreCase(getEnv("DRY_RUN", "false"));
        this.maxTicketsPerCycle = getIntEnv("MAX_TICKETS", 1);
        this.repoCloneDir = getEnv("REPO_CLONE_DIR", "/tmp/repos");
        this.harnessConfig = HarnessConfig.fromEnvironment();
        this.sandboxConfig = SandboxConfig.fromEnvironment();
        if (this.repoOwner != null && !this.repoOwner.isBlank()) {
            validateCloneDir(this.repoCloneDir);
        }
    }

    private static void validateCloneDir(String dir) {
        Path path = Paths.get(dir);
        if (!Files.exists(path)) {
            try {
                Files.createDirectories(path);
            } catch (IOException e) {
                throw new IllegalStateException("Cannot create REPO_CLONE_DIR: " + dir + " - " + e.getMessage());
            }
        }
        if (!Files.isDirectory(path) || !Files.isWritable(path)) {
            throw new IllegalStateException("REPO_CLONE_DIR is not writable: " + dir);
        }
        try {
            Path testFile = path.resolve(".write-test");
            Files.writeString(testFile, "ok");
            Files.delete(testFile);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot write to REPO_CLONE_DIR: " + dir + " - " + e.getMessage());
        }
    }

    public String getAgentApiKey() { return agentApiKey; }
    public String getAgentId() { return agentId; }
    public String getBackendUrl() { return backendUrl; }
    public String getEnrollmentToken() { return enrollmentToken; }
    public String getCredentialsFile() { return credentialsFile; }
    public String getAgentAuthMode() { return agentAuthMode; }

    /** Set after first-boot enrollment resolves the server-assigned id. */
    public void setAgentId(String agentId) { this.agentId = agentId; }

    /** Set from the server during enrollment; client PROJECT_ID is only a hint. */
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public boolean staticCredentialsConfigured() {
        return agentApiKey != null && !agentApiKey.isBlank()
            && agentId != null && !agentId.isBlank();
    }

    public boolean hasEnrollmentSource() {
        return (enrollmentToken != null && !enrollmentToken.isBlank())
            || (credentialsFile != null && !credentialsFile.isBlank());
    }

    /**
     * Enrollment mode applies when explicitly requested, or when the legacy
     * static pair is absent. A static pair always wins in `auto` so existing
     * deployments are unchanged.
     */
    public boolean usesEnrollment() {
        return shouldEnroll(agentAuthMode, staticCredentialsConfigured(), hasEnrollmentSource());
    }

    static boolean shouldEnroll(String mode, boolean hasStaticCredentials, boolean hasEnrollmentSource) {
        if ("enroll".equals(mode)) return true;
        if ("legacy".equals(mode)) return false;
        return !hasStaticCredentials && hasEnrollmentSource;
    }

    public String getEnrollmentUrl() {
        if (enrollmentUrl != null && !enrollmentUrl.isBlank()) return enrollmentUrl;
        return getApiUrl() + "/agent-enrollment/enroll";
    }

    public String getRefreshUrl() {
        String explicit = getEnv("AGENT_ENROLLMENT_REFRESH_URL", null);
        if (explicit != null && !explicit.isBlank()) return explicit;
        String enroll = getEnrollmentUrl();
        return enroll.endsWith("/enroll")
            ? enroll.substring(0, enroll.length() - "/enroll".length()) + "/refresh"
            : getApiUrl() + "/agent-enrollment/refresh";
    }
    public String getProjectId() { return projectId; }
    public String getRepoOwner() { return repoOwner; }
    public String getRepoName() { return repoName; }
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
    public boolean isAllowPat() { return allowPat; }

    public HarnessConfig getHarnessConfig() { return harnessConfig; }
    public SandboxConfig getSandboxConfig() { return sandboxConfig; }
    public String getHarnessMode() { return harnessConfig.mode(); }
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
            ", repoCloneDir='" + repoCloneDir + '\'' +
            ", harnessMode='" + harnessConfig.mode() + '\'' +
            ", sandboxMode='" + sandboxConfig.mode() + '\'' +
            '}';
    }
}
