package com.vibecode.agent;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * fg-35: AgentApp must pass the provider object itself so refresh() reaches
 * GitHubTokenProvider instead of the GitHubTokenSource default.
 */
class AgentAppWiringTest {

    @Test
    void passesTheTokenProviderObjectToClients() throws Exception {
        String source = Files.readString(
            Path.of("src/main/java/com/vibecode/agent/AgentApp.java"),
            StandardCharsets.UTF_8);

        assertFalse(source.contains("githubTokenProvider::get"),
            "a method reference would bypass GitHubTokenProvider.refresh()");
        assertTrue(source.contains("new GitHubService(\n            githubTokenProvider"),
            "GitHubService must receive the provider object");
        assertTrue(source.contains("githubTokenProvider, githubAccessToken, harnessConfig"),
            "HarnessTicketProcessor must receive the provider object");
        assertTrue(source.contains("aiProvider, gitHubService,\n                githubTokenProvider"),
            "TicketProcessor must receive the provider object");
    }
}
