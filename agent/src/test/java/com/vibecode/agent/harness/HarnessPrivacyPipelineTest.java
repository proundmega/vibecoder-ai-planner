package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessPrivacyPipelineTest {

    private final HarnessPrivacyPipeline pipeline = new HarnessPrivacyPipeline();

    private static HarnessPrivacyPolicy policy(Map<String, Object> values) {
        return HarnessPrivacyPolicy.from(values);
    }

    @Test
    void preflightRedactsSecretsAndPiiInThePrompt() throws Exception {
        HarnessDataClassifier.Classification classification =
            pipeline.classify("ticket", List.of(), List.of());
        HarnessPrivacyPipeline.PreflightResult result = pipeline.preflight(
            "token sk-abcdefghijklmnopqrstuvwxyz012345 mail alice@example.com",
            classification,
            policy(Map.of("maxDataClass", "confidential")));

        assertFalse(result.prompt().contains("sk-abcdefghijklmnopqrstuvwxyz012345"));
        assertFalse(result.prompt().contains("alice@example.com"));
        assertTrue(result.prompt().contains("[REDACTED]"));
        assertTrue(result.prompt().contains("[REDACTED_EMAIL]"));
        assertEquals(1, result.secretRedactions());
        assertEquals(1, result.piiRedactions());
    }

    @Test
    void preflightBlocksSecretsWhenThePolicyRequiresIt() {
        HarnessDataClassifier.Classification classification =
            pipeline.classify("ticket", List.of(), List.of());

        HarnessPrivacyPipeline.PrivacyViolationException error = assertThrows(
            HarnessPrivacyPipeline.PrivacyViolationException.class,
            () -> pipeline.preflight(
                "token sk-abcdefghijklmnopqrstuvwxyz012345",
                classification,
                policy(Map.of("blockOnSecret", true))));

        assertTrue(error.getMessage().contains("Secret pattern"));
    }

    @Test
    void preflightBlocksPiiWhenThePolicyRequiresIt() {
        HarnessDataClassifier.Classification classification =
            pipeline.classify("ticket", List.of(), List.of());

        assertThrows(
            HarnessPrivacyPipeline.PrivacyViolationException.class,
            () -> pipeline.preflight(
                "mail alice@example.com",
                classification,
                policy(Map.of("blockOnPii", true))));
    }

    @Test
    void preflightRejectsAClassAboveTheProjectCeiling() {
        HarnessDataClassifier.Classification classification =
            pipeline.classify("ticket", List.of(), List.of("src/App.java"));

        assertThrows(
            HarnessPrivacyPipeline.PrivacyViolationException.class,
            () -> pipeline.preflight(
                "prompt",
                classification,
                policy(Map.of("maxDataClass", "internal"))));
    }

    @Test
    void preflightDoesNotRedactPiiWhenDisabled() throws Exception {
        HarnessDataClassifier.Classification classification =
            pipeline.classify("ticket", List.of(), List.of());

        HarnessPrivacyPipeline.PreflightResult result = pipeline.preflight(
            "mail alice@example.com",
            classification,
            policy(Map.of("redactPii", false)));

        assertTrue(result.prompt().contains("alice@example.com"));
        assertEquals(0, result.piiRedactions());
    }

    @Test
    void postflightRedactsVerificationOutputAndPublishText() throws Exception {
        HarnessPrivacyPipeline.PostflightResult result = pipeline.postflight(
            "output token sk-abcdefghijklmnopqrstuvwxyz012345 contact alice@example.com",
            policy(Map.of()));

        assertFalse(result.text().contains("sk-abcdefghijklmnopqrstuvwxyz012345"));
        assertFalse(result.text().contains("alice@example.com"));
        assertEquals(1, result.secretRedactions());
        assertEquals(1, result.piiRedactions());
    }

    @Test
    void postflightBlocksSecretsWhenThePolicyRequiresIt() {
        assertThrows(
            HarnessPrivacyPipeline.PrivacyViolationException.class,
            () -> pipeline.postflight(
                "token sk-abcdefghijklmnopqrstuvwxyz012345",
                policy(Map.of("blockOnSecret", true))));
    }

    @Test
    void eventPayloadDescribesTheDecisionWithoutLeakingContent() throws Exception {
        HarnessDataClassifier.Classification classification =
            pipeline.classify("ticket with alice@example.com", List.of(), List.of());
        HarnessPrivacyPolicy policy = policy(Map.of("policyVersion", 3));
        HarnessPrivacyPipeline.PreflightResult result = pipeline.preflight(
            "mail alice@example.com", classification, policy);

        Map<String, Object> payload = result.eventPayload(policy);

        assertEquals("confidential", payload.get("level"));
        assertEquals(true, payload.get("pii"));
        assertEquals(1, payload.get("piiRedactions"));
        assertEquals(3, payload.get("policyVersion"));
        assertFalse(payload.toString().contains("alice@example.com"));
    }
}
