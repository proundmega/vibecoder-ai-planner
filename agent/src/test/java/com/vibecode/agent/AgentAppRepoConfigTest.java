package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentAppRepoConfigTest {

    @Test
    void serverRepositoryOverridesEnvCoordinates() {
        AgentConfig config = new AgentConfig();
        config.setRepoCoordinates("env-owner", "env-repo");

        boolean applied = AgentApp.applyRepoCoordinates(
            config, Map.of("repoUrl", "https://github.com/server-org/server-repo.git"));

        assertTrue(applied);
        assertEquals("server-org", config.getRepoOwner());
        assertEquals("server-repo", config.getRepoName());
    }

    @Test
    void missingOrInvalidServerRepoKeepsEnvFallback() {
        AgentConfig config = new AgentConfig();
        config.setRepoCoordinates("env-owner", "env-repo");

        assertFalse(AgentApp.applyRepoCoordinates(config, null));
        assertFalse(AgentApp.applyRepoCoordinates(config, Map.of()));
        assertFalse(AgentApp.applyRepoCoordinates(config, Map.of("repoUrl", "not-a-repo")));

        assertEquals("env-owner", config.getRepoOwner());
        assertEquals("env-repo", config.getRepoName());
    }
}
