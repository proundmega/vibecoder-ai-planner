package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProviderSettingsTest {

    @Test
    void toStringRedactsApiKey() {
        ProviderSettings settings = new ProviderSettings(
            "opencode-go", "oc_sk_super_secret", "https://example", "beam-free", 4096);

        String text = settings.toString();

        assertFalse(text.contains("oc_sk_super_secret"));
        assertTrue(text.contains("[REDACTED]"));
        assertTrue(text.contains("beam-free"));
    }
}
