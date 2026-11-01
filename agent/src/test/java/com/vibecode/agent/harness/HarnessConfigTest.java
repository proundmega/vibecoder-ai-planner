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
    void defaultsToLegacyWithSafeBudgets() {
        HarnessConfig config = HarnessConfig.from(name -> null);

        assertEquals("legacy", config.mode());
        assertFalse(config.isEnabled());
        assertEquals("opencode", config.binary());
        assertEquals(Duration.ofMillis(30_000), config.startupTimeout());
        assertEquals(Duration.ofMillis(300_000), config.idleTimeout());
        assertEquals(Duration.ofMinutes(45), config.maxDuration());
        assertEquals(List.of(), config.verificationCommands());
        assertEquals(
            List.of(".env*", "**/.env*", "Jenkinsfile", "**/Jenkinsfile",
                ".github/**", "**/.github/**", "**/secrets/**"),
            config.protectedPaths());
        assertNull(config.modelOverride());
    }

    @Test
    void parsesDurationsCommandsAndModel() {
        Map<String, String> env = Map.of(
            "HARNESS_MODE", "opencode",
            "HARNESS_BIN", "/usr/local/bin/opencode",
            "HARNESS_STARTUP_TIMEOUT_MS", "45000",
            "HARNESS_IDLE_TIMEOUT_MS", "120000",
            "HARNESS_MAX_DURATION_MINUTES", "20",
            "HARNESS_VERIFY_COMMANDS", "npm test -- --run; npm run lint ",
            "HARNESS_PROTECTED_PATHS", ".env*;infra/secrets/**",
            "HARNESS_MODEL", "opencode-go/beam-free"
        );

        HarnessConfig config = HarnessConfig.from(env::get);

        assertTrue(config.isEnabled());
        assertEquals("/usr/local/bin/opencode", config.binary());
        assertEquals(Duration.ofSeconds(45), config.startupTimeout());
        assertEquals(Duration.ofSeconds(120), config.idleTimeout());
        assertEquals(Duration.ofMinutes(20), config.maxDuration());
        assertEquals(List.of("npm test -- --run", "npm run lint"), config.verificationCommands());
        assertEquals(List.of(".env*", "infra/secrets/**"), config.protectedPaths());
        assertEquals("opencode-go/beam-free", config.modelOverride());
    }

    @Test
    void invalidValuesFallBackToDefaults() {
        Map<String, String> env = Map.of(
            "HARNESS_STARTUP_TIMEOUT_MS", "not-a-number",
            "HARNESS_IDLE_TIMEOUT_MS", "-1",
            "HARNESS_MAX_DURATION_MINUTES", "0"
        );

        HarnessConfig config = HarnessConfig.from(env::get);

        assertEquals(Duration.ofMillis(30_000), config.startupTimeout());
        assertEquals(Duration.ofMillis(300_000), config.idleTimeout());
        assertEquals(Duration.ofMinutes(45), config.maxDuration());
    }

    @Test
    void validateRejectsBlankBinaryAndNonPositiveDurations() {
        HarnessConfig blankBinary = new HarnessConfig(
            "opencode", " ", Duration.ofSeconds(1), Duration.ofSeconds(1),
            Duration.ofMinutes(1), List.of(), List.of(), null);
        HarnessConfig zeroTimeout = new HarnessConfig(
            "opencode", "opencode", Duration.ZERO, Duration.ofSeconds(1),
            Duration.ofMinutes(1), List.of(), List.of(), null);

        assertThrows(IllegalStateException.class, blankBinary::validate);
        assertThrows(IllegalStateException.class, zeroTimeout::validate);
    }
}
