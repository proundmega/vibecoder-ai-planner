package com.vibecode.agent.service;

import com.vibecode.agent.config.AgentConfig;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GitServiceTest {

    @Test
    void githubDelegatesReviewRequestsToTheExistingClient() throws IOException {
        GitHubService github = mock(GitHubService.class);
        when(github.createPullRequest(anyString(), anyString(), anyString(), anyString()))
            .thenReturn("https://github.com/owner/repo/pull/7");

        GitService git = GitService.github(
            "https://github.com/owner/repo.git", "repo", github);

        assertEquals("github", git.provider());
        assertEquals("https://github.com/owner/repo.git", git.repoUrl());
        assertEquals("repo", git.repoName());
        assertTrue(git.supportsReviewRequests());
        assertEquals("https://github.com/owner/repo/pull/7",
            git.createReviewRequest("title", "body", "branch", "main"));
        verify(github).createPullRequest("title", "body", "branch", "main");
    }

    @Test
    void branchOnlyProvidersPublishWithoutAReviewRequest() throws IOException {
        GitService git = GitService.branchOnly(
            "local", "ssh://git@git.example.com/group/repo.git", "repo");

        assertEquals("local", git.provider());
        assertFalse(git.supportsReviewRequests());
        assertNull(git.createReviewRequest("title", "body", "branch", "main"));
    }

    @Test
    void credentialProviderDerivesProviderAndBuildsTheFacade() {
        AgentConfig forgejo = mock(AgentConfig.class);
        when(forgejo.getRepoProvider()).thenReturn("forgejo");
        when(forgejo.getRepoUrl()).thenReturn("https://git.example.com/group/sub/repo.git");
        when(forgejo.getRepoAuthMode()).thenReturn("pat");
        when(forgejo.getGitSshKeyFile()).thenReturn("/run/secrets/deploy-key");

        GitCredentialProvider selfHosted = GitCredentialProvider.fromConfig(forgejo);
        assertEquals("forgejo", selfHosted.provider());
        assertEquals("https://git.example.com/group/sub/repo.git", selfHosted.repoUrl());
        assertEquals("repo", selfHosted.repoName());
        assertEquals("pat", selfHosted.authMode());
        assertEquals("/run/secrets/deploy-key", selfHosted.sshKeyFile());
        assertNull(selfHosted.createGitHubService(mock(GitHubTokenSource.class)));
        assertFalse(selfHosted.createGitService(null).supportsReviewRequests());

        AgentConfig githubConfig = mock(AgentConfig.class);
        when(githubConfig.getRepoProvider()).thenReturn("github");
        when(githubConfig.getRepoUrl()).thenReturn("https://github.com/owner/repo.git");
        when(githubConfig.getRepoName()).thenReturn("repo");

        GitCredentialProvider githubCredentials = GitCredentialProvider.fromConfig(githubConfig);
        GitHubService github = githubCredentials.createGitHubService(mock(GitHubTokenSource.class));
        assertNotNull(github);
        GitService git = githubCredentials.createGitService(github);
        assertTrue(git.supportsReviewRequests());
        assertEquals("https://github.com/owner/repo.git", git.repoUrl());
    }
}
