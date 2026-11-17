package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessPrivacyPolicyTest {

    @Test
    void defaultsAreConservativeButDoNotBlockOnSecrets() {
        HarnessPrivacyPolicy policy = HarnessPrivacyPolicy.defaults();

        assertEquals(HarnessPrivacyPolicy.CONFIDENTIAL, policy.maxDataClass());
        assertTrue(policy.allowedProviders().isEmpty());
        assertFalse(policy.localOnly());
        assertFalse(policy.requireNoTraining());
        assertFalse(policy.blockOnSecret());
        assertFalse(policy.blockOnPii());
        assertTrue(policy.redactPii());
        assertEquals(30, policy.eventRetentionDays());
        assertEquals(7, policy.artifactRetentionDays());
        assertEquals("default", policy.source());
    }

    @Test
    void fromMapsBackendPolicyAndFallsBackForMissingFields() {
        HarnessPrivacyPolicy policy = HarnessPrivacyPolicy.from(Map.of(
            "maxDataClass", "internal",
            "allowedProviders", List.of("OpenAI", "opencode_go"),
            "blockOnSecret", true,
            "blockOnPii", true,
            "redactPii", false,
            "eventRetentionDays", 14,
            "artifactRetentionDays", 3,
            "policyVersion", 4,
            "source", "project"
        ));

        assertEquals(HarnessPrivacyPolicy.INTERNAL, policy.maxDataClass());
        assertEquals(List.of("openai", "opencode-go"), policy.allowedProviders());
        assertTrue(policy.blockOnSecret());
        assertTrue(policy.blockOnPii());
        assertFalse(policy.redactPii());
        assertEquals(14, policy.eventRetentionDays());
        assertEquals(3, policy.artifactRetentionDays());
        assertEquals(4, policy.policyVersion());
        assertEquals("project", policy.source());
    }

    @Test
    void fromUsesDefaultsForAnEmptyMap() {
        HarnessPrivacyPolicy policy = HarnessPrivacyPolicy.from(Map.of());

        assertEquals(HarnessPrivacyPolicy.CONFIDENTIAL, policy.maxDataClass());
        assertEquals("default", policy.source());
    }

    @Test
    void unknownClassificationIsTreatedAsSecret() {
        HarnessPrivacyPolicy policy = new HarnessPrivacyPolicy(
            "top-secret", List.of(), false, false, null, null, null,
            false, false, true, 30, 7, 1, "project");

        assertEquals(HarnessPrivacyPolicy.SECRET, policy.maxDataClass());
        assertTrue(policy.allowsClass(HarnessPrivacyPolicy.PUBLIC));
        assertTrue(policy.allowsClass(HarnessPrivacyPolicy.SECRET));
    }

    @Test
    void allowsOnlyClassesAtOrBelowTheCeiling() {
        HarnessPrivacyPolicy policy = HarnessPrivacyPolicy.from(Map.of(
            "maxDataClass", "internal"));

        assertTrue(policy.allowsClass(HarnessPrivacyPolicy.PUBLIC));
        assertTrue(policy.allowsClass(HarnessPrivacyPolicy.INTERNAL));
        assertFalse(policy.allowsClass(HarnessPrivacyPolicy.CONFIDENTIAL));
        assertFalse(policy.allowsClass(HarnessPrivacyPolicy.SECRET));
    }

    @Test
    void localOnlyOrSecretCeilingRequiresALocalEndpoint() {
        assertTrue(HarnessPrivacyPolicy.from(Map.of("localOnly", true))
            .requiresLocalEndpoint());
        assertTrue(HarnessPrivacyPolicy.from(Map.of("maxDataClass", "secret"))
            .requiresLocalEndpoint());
        assertFalse(HarnessPrivacyPolicy.from(Map.of("maxDataClass", "internal"))
            .requiresLocalEndpoint());
    }

    @Test
    void ranksClassesAndTreatsUnknownAsMostRestrictive() {
        assertEquals(0, HarnessPrivacyPolicy.rank("public"));
        assertEquals(3, HarnessPrivacyPolicy.rank("secret"));
        assertEquals(3, HarnessPrivacyPolicy.rank("unknown"));
        assertEquals(3, HarnessPrivacyPolicy.rank(null));
    }
}
