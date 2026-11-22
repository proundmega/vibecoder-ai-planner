package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessConfigTest {

    @Test
    void defaultsWithSafeBudgets() {
        HarnessConfig config = HarnessConfig.from(name -> null);

        assertEquals("opencode", config.binary());
        assertEquals(Duration.ofMillis(30_000), config.startupTimeout());
        assertEquals(Duration.ofMinutes(45), config.maxDuration());
        assertEquals(List.of(), config.verificationCommands());
        assertEquals(
            List.of(".env*", "**/.env*", "Jenkinsfile", "**/Jenkinsfile",
                ".github/**", "**/.github/**", "**/secrets/**"),
            config.protectedPaths());
        assertNull(config.modelOverride());
        assertEquals("restart", config.resumeMode());
        assertFalse(config.questionLoop().enabled());
        assertEquals(Duration.ofMinutes(60), config.questionLoop().timeout());
        assertEquals(Duration.ofSeconds(5), config.questionLoop().pollInterval());
    }

    @Test
    void parsesTheQuestionLoopFlags() {
        Map<String, String> env = Map.of(
            "HARNESS_QUESTION_LOOP", "true",
            "HARNESS_QUESTION_TIMEOUT_MINUTES", "15",
            "HARNESS_QUESTION_POLL_SECONDS", "2",
            "HARNESS_DOOM_LOOP_MAX", "4",
            "HARNESS_DOOM_LOOP_CONTINUES", "2"
        );

        HarnessConfig config = HarnessConfig.from(env::get);

        assertTrue(config.questionLoop().enabled());
        assertEquals(Duration.ofMinutes(15), config.questionLoop().timeout());
        assertEquals(Duration.ofSeconds(2), config.questionLoop().pollInterval());
        assertEquals(4, config.questionLoop().doomLoopMax());
        assertEquals(2, config.questionLoop().doomLoopContinues());
    }

    @Test
    void parsesDurationsCommandsAndModel() {
        Map<String, String> env = Map.of(
            "HARNESS_BIN", "/usr/local/bin/opencode",
            "HARNESS_STARTUP_TIMEOUT_MS", "45000",
            "HARNESS_MAX_DURATION_MINUTES", "20",
            "HARNESS_VERIFY_COMMANDS", "npm test -- --run; npm run lint ",
            "HARNESS_PROTECTED_PATHS", ".env*;infra/secrets/**",
            "HARNESS_MODEL", "opencode-go/beam-free",
            "HARNESS_RESUME_MODE", "RESUME"
        );

        HarnessConfig config = HarnessConfig.from(env::get);

        assertEquals("/usr/local/bin/opencode", config.binary());
        assertEquals(Duration.ofSeconds(45), config.startupTimeout());
        assertEquals(Duration.ofMinutes(20), config.maxDuration());
        assertEquals(List.of("npm test -- --run", "npm run lint"), config.verificationCommands());
        assertEquals(List.of(".env*", "infra/secrets/**"), config.protectedPaths());
        assertEquals("opencode-go/beam-free", config.modelOverride());
        assertEquals("resume", config.resumeMode());
    }

    @Test
    void invalidValuesFallBackToDefaults() {
        Map<String, String> env = Map.of(
            "HARNESS_STARTUP_TIMEOUT_MS", "not-a-number",
            "HARNESS_MAX_DURATION_MINUTES", "0"
        );

        HarnessConfig config = HarnessConfig.from(env::get);

        assertEquals(Duration.ofMillis(30_000), config.startupTimeout());
        assertEquals(Duration.ofMinutes(45), config.maxDuration());
    }

    @Test
    void validateRejectsBlankBinaryAndNonPositiveDurations() {
        HarnessConfig blankBinary = new HarnessConfig(
            
            " ", Duration.ofSeconds(1),
            Duration.ofMinutes(1), List.of(), List.of(), null, "restart");
        HarnessConfig zeroTimeout = new HarnessConfig(
            
            "opencode", Duration.ZERO,
            Duration.ofMinutes(1), List.of(), List.of(), null, "restart");

        assertThrows(IllegalStateException.class, blankBinary::validate);
        assertThrows(IllegalStateException.class, zeroTimeout::validate);

        HarnessConfig badResume = new HarnessConfig(
            
            "opencode", Duration.ofSeconds(1),
            Duration.ofMinutes(1), List.of(), List.of(), null, "replay");
        assertThrows(IllegalStateException.class, badResume::validate);
    }
}
