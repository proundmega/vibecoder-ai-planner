package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentConfigPrecedenceTest {

    @Test
    void staticCredentialsWinInAutoMode() {
        assertFalse(AgentConfig.shouldEnroll("auto", true, true));
        assertFalse(AgentConfig.shouldEnroll("auto", true, false));
    }

    @Test
    void autoModeEnrollsOnlyWhenNoStaticPairExists() {
        assertTrue(AgentConfig.shouldEnroll("auto", false, true));
        assertFalse(AgentConfig.shouldEnroll("auto", false, false));
    }

    @Test
    void explicitModesOverrideAutoPrecedence() {
        assertTrue(AgentConfig.shouldEnroll("enroll", true, false));
        assertFalse(AgentConfig.shouldEnroll("legacy", false, true));
    }
}
