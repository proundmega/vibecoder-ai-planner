package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for AgentConfig parsing and validation.
 */
class AgentConfigTest {

    @Test
    void testGetGitHubBranchName() {
        AgentConfig config = new AgentConfig();
        String branchName = config.getGitHubBranchName(42, "Fix authentication middleware");
        assertEquals("vibecode/ticket-42-fix-authentication-middleware", branchName);
    }

    @Test
    void testGetGitHubBranchNameWithSpecialChars() {
        AgentConfig config = new AgentConfig();
        String branchName = config.getGitHubBranchName(99, "Add $upport for @users & teams!");
        assertEquals("vibecode/ticket-99-add-support-for-users-teams", branchName);
    }

    @Test
    void testGetGitHubBranchNameLongTitle() {
        AgentConfig config = new AgentConfig();
        String longTitle = "This is a very long ticket title that should be truncated to fifty characters maximum as per the naming convention";
        String branchName = config.getGitHubBranchName(1, longTitle);
        assertTrue(branchName.startsWith("vibecode/ticket-1-"));
        // The slug part should be at most 50 chars
        String slug = branchName.substring("vibecode/ticket-1-".length());
        assertTrue(slug.length() <= 50);
    }

    @Test
    void testGetApiUrl() {
        AgentConfig config = new AgentConfig();
        String apiUrl = config.getApiUrl();
        assertTrue(apiUrl.endsWith("/api"));
    }
}
