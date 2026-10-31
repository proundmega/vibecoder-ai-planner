package com.vibecode.agent.config;

import com.vibecode.agent.harness.HarnessConfig;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for AgentConfig parsing and validation.
 */
class AgentConfigTest {

    @Test
    void testGetGitHubBranchName() {
        AgentConfig config = new AgentConfig();
        String branchName = config.getGitHubBranchName(42L, "Fix authentication middleware");
        assertEquals("vibecode/ticket-42-fix-authentication-middleware", branchName);
    }

    @Test
    void testGetGitHubBranchNameWithSpecialChars() {
        AgentConfig config = new AgentConfig();
        String branchName = config.getGitHubBranchName(99L, "Add support for @users & teams!");
        assertEquals("vibecode/ticket-99-add-support-for-users-teams", branchName);
    }

    @Test
    void testGetGitHubBranchNameLongTitle() {
        AgentConfig config = new AgentConfig();
        String longTitle = "This is a very long ticket title that should be truncated to fifty characters maximum as per the naming convention";
        String branchName = config.getGitHubBranchName(1L, longTitle);
        assertTrue(branchName.startsWith("vibecode/ticket-1-"));
        // The slug part should be at most 50 chars
        String slug = branchName.substring("vibecode/ticket-1-".length());
        assertTrue(slug.length() <= 50);
    }

    @Test
    void testGetApiUrl() {
        AgentConfig config = new AgentConfig();
        String apiUrl = config.getApiUrl();
        assertTrue(apiUrl.endsWith("/api/v1"));
    }

    @Test
    void testHarnessConfigMatchesEnvironment() {
        AgentConfig config = new AgentConfig();
        HarnessConfig expected = HarnessConfig.fromEnvironment();

        assertEquals(expected.mode(), config.getHarnessMode());
        assertEquals(expected.binary(), config.getHarnessBin());
        assertEquals(expected.startupTimeout().toMillis(), config.getHarnessStartupTimeoutMs());
        assertEquals(expected.idleTimeout().toMillis(), config.getHarnessIdleTimeoutMs());
        assertEquals(expected.maxDuration().toMinutes(), config.getHarnessMaxDurationMinutes());
        assertEquals(expected.protectedPaths(), config.getHarnessProtectedPaths());
        assertEquals(expected.modelOverride(), config.getHarnessModel());
    }

    @Test
    void testToStringNeverIncludesSecrets() {
        AgentConfig config = new AgentConfig();
        String text = config.toString();

        assertFalse(text.contains("OPENCODE_SERVER_PASSWORD"));
        assertFalse(text.contains("provider.key"));
        if (config.getAiApiKey() != null) {
            assertFalse(text.contains(config.getAiApiKey()));
        }
        if (config.getGitHubToken() != null) {
            assertFalse(text.contains(config.getGitHubToken()));
        }
    }
}
