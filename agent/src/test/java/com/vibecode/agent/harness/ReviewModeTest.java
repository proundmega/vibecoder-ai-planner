package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewModeTest {

    @Test
    void defaultsToLegacy() {
        ReviewMode mode = ReviewMode.from(name -> null);

        assertEquals(ReviewMode.Mode.LEGACY, mode.mode());
        assertFalse(mode.harnessEnabled());
        assertFalse(mode.legacyShadow());
        assertTrue(mode.legacyWritesAllowed());
    }

    @Test
    void selectsTheOpenCodeHarness() {
        ReviewMode mode = ReviewMode.from(Map.of("REVIEW_HARNESS_MODE", "opencode")::get);

        assertEquals(ReviewMode.Mode.OPENCODE, mode.mode());
        assertTrue(mode.harnessEnabled());
        assertFalse(mode.legacyWritesAllowed());
    }

    @Test
    void shadowModeSuppressesLegacyWrites() {
        Map<String, String> env = new HashMap<>();
        env.put("REVIEW_HARNESS_MODE", "legacy");
        env.put("REVIEW_LEGACY_SHADOW", "true");

        ReviewMode mode = ReviewMode.from(env::get);

        assertTrue(mode.legacyShadow());
        assertFalse(mode.legacyWritesAllowed());
    }

    @Test
    void rejectsUnknownModesAndShadowValues() {
        assertThrows(IllegalArgumentException.class,
            () -> ReviewMode.from(Map.of("REVIEW_HARNESS_MODE", "auto")::get));
        assertThrows(IllegalArgumentException.class,
            () -> ReviewMode.from(Map.of("REVIEW_LEGACY_SHADOW", "sometimes")::get));
    }
}
