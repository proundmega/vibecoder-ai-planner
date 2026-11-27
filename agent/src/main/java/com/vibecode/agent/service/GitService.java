package com.vibecode.agent.service;

import java.io.IOException;

/**
 * Provider-neutral repository identity and review request for the harness.
 * Clone/commit/push stay in {@link WorkspaceManager}.
 */
public final class GitService {

    @FunctionalInterface
    public interface ReviewClient {
        String createReviewRequest(
            long ticketId,
            String title,
            String body,
            String headBranch,
            String baseBranch
        ) throws IOException;
    }

    private final String provider;
    private final String repoUrl;
    private final String repoName;
    private final boolean supportsReviewRequests;
    private final ReviewClient reviewClient;

    private GitService(
        String provider,
        String repoUrl,
        String repoName,
        boolean supportsReviewRequests,
        ReviewClient reviewClient
    ) {
        this.provider = provider == null || provider.isBlank() ? "github" : provider;
        this.repoUrl = repoUrl;
        this.repoName = repoName;
        this.supportsReviewRequests = supportsReviewRequests;
        this.reviewClient = reviewClient;
    }

    public static GitService github(String repoUrl, String repoName, GitHubService gitHubService) {
        if (gitHubService == null) {
            throw new IllegalArgumentException("GitHubService is required for GitHub review requests");
        }
        return new GitService("github", repoUrl, repoName, true,
            (ticketId, title, body, headBranch, baseBranch) ->
                gitHubService.createPullRequest(title, body, headBranch, baseBranch));
    }

    /**
     * Self-hosted providers create the review through the backend, which owns
     * the provider client, token and branch/base resolution.
     */
    public static GitService withReviewClient(
        String provider,
        String repoUrl,
        String repoName,
        ReviewClient reviewClient
    ) {
        if (reviewClient == null) {
            throw new IllegalArgumentException("A review client is required for review requests");
        }
        return new GitService(provider, repoUrl, repoName, true, reviewClient);
    }

    public static GitService branchOnly(String provider, String repoUrl, String repoName) {
        return new GitService(provider, repoUrl, repoName, false, null);
    }

    public String provider() { return provider; }
    public String repoUrl() { return repoUrl; }
    public String repoName() { return repoName; }
    public boolean supportsReviewRequests() { return supportsReviewRequests; }

    public String createReviewRequest(
        long ticketId,
        String title,
        String body,
        String headBranch,
        String baseBranch
    ) throws IOException {
        if (!supportsReviewRequests || reviewClient == null) {
            return null;
        }
        return reviewClient.createReviewRequest(
            ticketId, title, body, headBranch, baseBranch);
    }
}
