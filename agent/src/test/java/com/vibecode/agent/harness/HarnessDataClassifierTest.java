package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessDataClassifierTest {

    private final HarnessDataClassifier classifier = new HarnessDataClassifier();

    @Test
    void emptyInputIsPublic() {
        HarnessDataClassifier.Classification result =
            classifier.classify(null, List.of(), List.of());

        assertEquals(HarnessPrivacyPolicy.PUBLIC, result.level());
        assertFalse(result.secret());
        assertFalse(result.pii());
        assertTrue(result.reasons().isEmpty());
    }

    @Test
    void ticketAndPlanningTextIsInternal() {
        HarnessDataClassifier.Classification result = classifier.classify(
            "Implement the login form",
            List.of("planning/fg-42/01.md"),
            List.of());

        assertEquals(HarnessPrivacyPolicy.INTERNAL, result.level());
        assertTrue(result.reasons().contains("ticket text"));
        assertTrue(result.reasons().contains("planning documents"));
    }

    @Test
    void repositoryChangesAreConfidential() {
        HarnessDataClassifier.Classification result = classifier.classify(
            null, List.of(), List.of("src/main/App.java"));

        assertEquals(HarnessPrivacyPolicy.CONFIDENTIAL, result.level());
        assertTrue(result.reasons().contains("repository source changes"));
    }

    @Test
    void sensitiveRepositoryPathsAreSecret() {
        HarnessDataClassifier.Classification result = classifier.classify(
            null,
            List.of(),
            List.of("config/.env.production", "src/main/App.java"));

        assertEquals(HarnessPrivacyPolicy.SECRET, result.level());
        assertTrue(result.secret());
        assertTrue(result.reasons().contains("sensitive repository path"));
    }

    @Test
    void piiRaisesTheClassificationToConfidential() {
        HarnessDataClassifier.Classification result = classifier.classify(
            "Contact alice@example.com",
            List.of(),
            List.of());

        assertEquals(HarnessPrivacyPolicy.CONFIDENTIAL, result.level());
        assertTrue(result.pii());
        assertFalse(result.secret());
        assertTrue(result.reasons().contains("PII pattern"));
    }

    @Test
    void secretPatternWinsOverEveryOtherClass() {
        HarnessDataClassifier.Classification result = classifier.classify(
            "token sk-abcdefghijklmnopqrstuvwxyz012345",
            List.of("planning doc"),
            List.of("src/main/App.java"));

        assertEquals(HarnessPrivacyPolicy.SECRET, result.level());
        assertTrue(result.secret());
        assertTrue(result.reasons().contains("secret pattern"));
    }
}
