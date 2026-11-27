package com.vibecode.agent.service;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.config.RepoCoordinates;

import java.util.Optional;

/** Resolves the project repository identity and provider client. */
public final class GitCredentialProvider {

    private final String provider;
    private final String repoUrl;
    private final String repoName;
    private final String authMode;
    private final String sshKeyFile;

    public GitCredentialProvider(
        String provider,
        String repoUrl,
        String repoName,
        String authMode,
        String sshKeyFile
    ) {
        this.provider = provider == null || provider.isBlank()
            ? "github"
            : provider.trim().toLowerCase();
        this.repoUrl = repoUrl;
        this.repoName = repoName == null || repoName.isBlank()
            ? RepoCoordinates.parse(repoUrl).map(RepoCoordinates::name).orElse("repo")
            : repoName;
        this.authMode = authMode;
        this.sshKeyFile = sshKeyFile;
    }

    public static GitCredentialProvider fromConfig(AgentConfig config) {
        return new GitCredentialProvider(
            config.getRepoProvider(),
            config.getRepoUrl(),
            config.getRepoName(),
            config.getRepoAuthMode(),
            config.getGitSshKeyFile()
        );
    }

    public String provider() { return provider; }
    public String repoUrl() { return repoUrl; }
    public String repoName() { return repoName; }
    public String authMode() { return authMode; }
    public String sshKeyFile() { return sshKeyFile; }

    public GitHubService createGitHubService(GitHubTokenSource tokenSource) {
        if (!"github".equals(provider)) {
            return null;
        }
        Optional<RepoCoordinates> coordinates = RepoCoordinates.parse(repoUrl);
        return new GitHubService(
            tokenSource,
            coordinates.map(RepoCoordinates::owner).orElse(null),
            coordinates.map(RepoCoordinates::name).orElse(repoName));
    }

    public GitService createGitService(GitHubService gitHubService) {
        return createGitService(gitHubService, null);
    }

    public GitService createGitService(
        GitHubService gitHubService,
        GitService.ReviewClient reviewClient
    ) {
        if ("github".equals(provider) && gitHubService != null) {
            return GitService.github(repoUrl, repoName, gitHubService);
        }
        // Local bare/SSH has no review API; every other self-hosted provider
        // creates the review through the backend proxy (which returns
        // branch-only evidence when it cannot open one).
        if (reviewClient != null && !"local".equals(provider)) {
            return GitService.withReviewClient(provider, repoUrl, repoName, reviewClient);
        }
        return GitService.branchOnly(provider, repoUrl, repoName);
    }
}
