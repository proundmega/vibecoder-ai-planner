package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentConfigModeTest {

    @Test
    void explicitModesWin() {
        assertTrue(AgentConfig.shouldReview("review", "owner"));
        assertFalse(AgentConfig.shouldReview("build", null));
    }

    @Test
    void autoModePreservesTheLegacyEnvRepoSignal() {
        assertFalse(AgentConfig.shouldReview("auto", "owner"));
        assertTrue(AgentConfig.shouldReview("auto", null));
        assertTrue(AgentConfig.shouldReview("auto", ""));
    }
}
