package com.vibecode.agent.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-54 FR19: canonical effort, model default, runtime override and provider mapping. */
class ProviderEffortTest {

    @Test
    void resolvesTheModelDefaultAndRuntimeOverride() {
        assertEquals("medium", ProviderEffort.resolve(null, null));
        assertEquals("high", ProviderEffort.resolve("high", null));
        assertEquals("max", ProviderEffort.resolve("medium", "max"));
        assertEquals("low", ProviderEffort.resolve("high", "low"));
    }

    @Test
    void acceptsCanonicalValuesAndCommonAliases() {
        assertEquals("minimal", ProviderEffort.canonical("MIN"));
        assertEquals("medium", ProviderEffort.canonical("normal"));
        assertEquals("high", ProviderEffort.canonical("hi"));
        assertEquals("max", ProviderEffort.canonical("xhigh"));
        assertTrue(ProviderEffort.isCanonical("max"));
    }

    @Test
    void rejectsUnknownValuesInsteadOfSilentlyDroppingThem() {
        assertThrows(IllegalArgumentException.class, () -> ProviderEffort.canonical("extreme"));
        assertThrows(IllegalArgumentException.class, () -> ProviderEffort.canonical("3"));
        assertFalse(ProviderEffort.isCanonical("extreme"));
    }

    @Test
    void mapsOpenAiEffortAndClampsMaxToHigh() {
        assertEquals("minimal", ProviderEffort.reasoningEffort("openai", "minimal"));
        assertEquals("medium", ProviderEffort.reasoningEffort("openai", "medium"));
        assertEquals("high", ProviderEffort.reasoningEffort("openai", "max"));
        assertTrue(ProviderEffort.usesReasoningEffort("openai"));
    }

    @Test
    void leavesLocalOpenAiCompatibleEffortCanonical() {
        assertEquals("max", ProviderEffort.reasoningEffort("ollama", "max"));
        assertEquals("high", ProviderEffort.reasoningEffort("vllm", "high"));
        assertEquals("low", ProviderEffort.reasoningEffort("generic", "low"));
    }

    @Test
    void expressesAnthropicEffortAsAnIncreasingThinkingBudget() {
        assertNull(ProviderEffort.reasoningEffort("anthropic", "max"));
        assertFalse(ProviderEffort.usesReasoningEffort("claude"));

        int minimal = ProviderEffort.thinkingBudgetTokens("minimal");
        int low = ProviderEffort.thinkingBudgetTokens("low");
        int medium = ProviderEffort.thinkingBudgetTokens("medium");
        int high = ProviderEffort.thinkingBudgetTokens("high");
        int max = ProviderEffort.thinkingBudgetTokens("max");
        assertTrue(minimal < low);
        assertTrue(low < medium);
        assertTrue(medium < high);
        assertTrue(high < max);
    }
}
