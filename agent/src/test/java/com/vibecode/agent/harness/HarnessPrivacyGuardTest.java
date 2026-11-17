package com.vibecode.agent.harness;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessPrivacyGuardTest {

    @AfterEach
    void reset() {
        HarnessPrivacyGuard.configure(null);
    }

    @Test
    void modelBoundaryRedactsSecretsAndPiiByDefault() throws Exception {
        String output = HarnessPrivacyGuard.forModel(
            "token sk-abcdefghijklmnopqrstuvwxyz012345 mail alice@example.com");

        assertFalse(output.contains("sk-abcdefghijklmnopqrstuvwxyz012345"));
        assertFalse(output.contains("alice@example.com"));
        assertTrue(output.contains("[REDACTED]"));
        assertTrue(output.contains("[REDACTED_EMAIL]"));
    }

    @Test
    void modelBoundaryBlocksSecretsWhenThePolicyRequiresIt() {
        HarnessPrivacyGuard.configure(HarnessPrivacyPolicy.from(
            Map.of("blockOnSecret", true)));

        assertThrows(HarnessPrivacyPipeline.PrivacyViolationException.class,
            () -> HarnessPrivacyGuard.forModel(
                "token sk-abcdefghijklmnopqrstuvwxyz012345"));
    }

    @Test
    void modelBoundaryBlocksPiiEvenWhenRedactionIsDisabled() {
        HarnessPrivacyGuard.configure(HarnessPrivacyPolicy.from(
            Map.of("blockOnPii", true, "redactPii", false)));

        assertThrows(HarnessPrivacyPipeline.PrivacyViolationException.class,
            () -> HarnessPrivacyGuard.forModel("mail alice@example.com"));
    }

    @Test
    void storageBoundaryAlwaysRedactsPii() {
        assertEquals("mail [REDACTED_EMAIL]",
            HarnessPrivacyGuard.forStorage("mail alice@example.com"));
    }
}
