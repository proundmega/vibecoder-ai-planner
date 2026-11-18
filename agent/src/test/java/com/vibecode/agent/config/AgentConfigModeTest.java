package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentConfigModeTest {

    @Test
    void explicitModesWin() {
        assertTrue(AgentConfig.shouldReview("review", "owner", "repo"));
        assertFalse(AgentConfig.shouldReview("build", null, null));
    }

    @Test
    void parsesAndTrimsModes() {
        assertEquals("build", AgentConfig.parseAgentMode(" BUILD "));
        assertEquals("auto", AgentConfig.parseAgentMode(null));
        assertEquals("auto", AgentConfig.parseAgentMode("  "));
        assertThrows(IllegalStateException.class, () -> AgentConfig.parseAgentMode("worker"));
    }

    @Test
    void autoModePreservesTheLegacyEnvRepoSignal() {
        assertFalse(AgentConfig.shouldReview("auto", "owner", "repo"));
        assertTrue(AgentConfig.shouldReview("auto", null, null));
        assertTrue(AgentConfig.shouldReview("auto", "", ""));
        assertTrue(AgentConfig.shouldReview("auto", "owner", null));
    }
}
