package com.vibecode.agent.config;

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
 *   AI_PROVIDER         - AI provider to use: claude or openai (default: claude)
 *   AI_MODEL            - AI model name (default: claude-sonnet-4-20250514)
 *   AI_API_KEY          - AI provider API key (falls back to env if not in DB)
 *   AI_ENDPOINT_URL     - OpenAI-compatible endpoint URL (e.g., http://localhost:11434/v1)
 *   AI_MAX_TOKENS       - Max tokens for AI responses (default: 4096)
 *   GITHUB_TOKEN        - GitHub Personal Access Token (falls back to backend API)
 *   DRY_RUN             - If "true", don't create branches/PRs (default: false)
 *   MAX_TICKETS         - Max tickets to process per cycle (default: 1)
 *   REPO_CLONE_DIR      - Directory to clone repos into (default: /repos)
 */
public class AgentConfig {

    private final String agentApiKey;
    private final String agentId;
    private final String backendUrl;
    private final String projectId;
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

    public AgentConfig() {
        this.agentApiKey = requireEnv("AGENT_API_KEY");
        this.agentId = requireEnv("AGENT_ID");
        this.backendUrl = requireEnv("BACKEND_URL");
        this.projectId = requireEnv("PROJECT_ID");
        this.repoOwner = requireEnv("REPO_OWNER");
        this.repoName = requireEnv("REPO_NAME");
        this.pollInterval = Duration.ofMillis(getLongEnv("POLL_INTERVAL_MS", 30000));
        this.staleTimeout = Duration.ofMillis(getLongEnv("STALE_TIMEOUT_MS", 3600000));
        this.aiProvider = getEnv("AI_PROVIDER", "claude");
        this.aiModel = getEnv("AI_MODEL", "claude-sonnet-4-20250514");
        this.aiApiKey = getEnv("AI_API_KEY", null);
        this.aiEndpointUrl = getEnv("AI_ENDPOINT_URL", "");
        this.aiMaxTokens = getIntEnv("AI_MAX_TOKENS", 4096);
        this.githubToken = getEnv("GITHUB_TOKEN", null);
        this.dryRun = "true".equalsIgnoreCase(getEnv("DRY_RUN", "false"));
        this.maxTicketsPerCycle = getIntEnv("MAX_TICKETS", 1);
        this.repoCloneDir = getEnv("REPO_CLONE_DIR", "/repos");
    }

    public String getAgentApiKey() { return agentApiKey; }
    public String getAgentId() { return agentId; }
    public String getBackendUrl() { return backendUrl; }
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

    public String getApiUrl() {
        return backendUrl.endsWith("/") ? backendUrl + "api" : backendUrl + "/api";
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
            '}';
    }
}
