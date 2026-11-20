package com.vibecode.agent.service;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Canonical reasoning-effort handling for fg-54.
 *
 * <p>The API and database store one closed enum ({@code minimal}, {@code low},
 * {@code medium}, {@code high}, {@code max}). Providers expose different names
 * and ceilings, so this class resolves a canonical value and maps it to the
 * provider-specific request field. Mapping never silently drops the value: a
 * provider with a lower ceiling is clamped and an unsupported value is passed
 * through unchanged (or expressed as a thinking budget for Anthropic).</p>
 */
public final class ProviderEffort {

    public static final String MINIMAL = "minimal";
    public static final String LOW = "low";
    public static final String MEDIUM = "medium";
    public static final String HIGH = "high";
    public static final String MAX = "max";
    public static final String DEFAULT = MEDIUM;

    private static final Map<String, String> ALIASES = Map.ofEntries(
        Map.entry("min", MINIMAL),
        Map.entry("lowest", MINIMAL),
        Map.entry("medium", MEDIUM),
        Map.entry("normal", MEDIUM),
        Map.entry("default", MEDIUM),
        Map.entry("hi", HIGH),
        Map.entry("higher", HIGH),
        Map.entry("xhigh", MAX),
        Map.entry("highest", MAX),
        Map.entry("maximum", MAX),
        Map.entry("ultra", MAX)
    );

    private static final Set<String> CANONICAL = Set.of(MINIMAL, LOW, MEDIUM, HIGH, MAX);

    private ProviderEffort() {
    }

    /**
     * Validate a canonical value. {@code null} resolves to the model default.
     *
     * @throws IllegalArgumentException when the value is not a canonical effort
     */
    public static String canonical(String value) {
        if (value == null || value.isBlank()) {
            return DEFAULT;
        }
        String normalized = normalize(value);
        String mapped = ALIASES.getOrDefault(normalized, normalized);
        if (!CANONICAL.contains(mapped)) {
            throw new IllegalArgumentException(
                "effort must be one of minimal|low|medium|high|max (got '" + value + "')");
        }
        return mapped;
    }

    /** Resolve the runtime override against the model default. */
    public static String resolve(String modelDefault, String runtimeOverride) {
        if (runtimeOverride != null && !runtimeOverride.isBlank()) {
            return canonical(runtimeOverride);
        }
        return canonical(modelDefault);
    }

    /**
     * Provider-specific reasoning field value (OpenAI-compatible
     * {@code reasoning_effort}). Anthropic has no equivalent field; callers use
     * {@link #thinkingBudgetTokens(String)} instead.
     */
    public static String reasoningEffort(String providerType, String canonicalEffort) {
        String value = canonical(canonical(canonicalEffort));
        String type = normalizeProvider(providerType);
        if (isAnthropic(type)) {
            return null;
        }
        if (isOpenAi(type)) {
            // gpt-5 style names: minimal|low|medium|high (no "max").
            return MAX.equals(value) ? HIGH : value;
        }
        if (isLocal(type)) {
            // Local OpenAI-compatible servers commonly accept the field and
            // ignore unknown values; keep the canonical name rather than drop.
            return value;
        }
        return value;
    }

    /** Anthropic extended-thinking budget for a canonical effort. */
    public static int thinkingBudgetTokens(String canonicalEffort) {
        return switch (canonical(canonicalEffort)) {
            case MINIMAL -> 1024;
            case LOW -> 2048;
            case MEDIUM -> 4096;
            case HIGH -> 8192;
            case MAX -> 16384;
            default -> 4096;
        };
    }

    /** True when the provider accepts the {@code reasoning_effort} field. */
    public static boolean usesReasoningEffort(String providerType) {
        return reasoningEffort(providerType, MEDIUM) != null;
    }

    /**
     * Model-aware reasoning effort. Older OpenAI chat models reject
     * {@code reasoning_effort}; return null unless the model is a known
     * reasoning family.
     */
    public static String reasoningEffort(String providerType, String canonicalEffort, String model) {
        String type = normalizeProvider(providerType);
        if ("openai".equals(type) || "open-ai".equals(type)) {
            if (!supportsReasoningEffortModel(model)) {
                return null;
            }
        }
        return reasoningEffort(providerType, canonicalEffort);
    }

    /** True for Anthropic models that support extended thinking. */
    public static boolean supportsThinking(String model) {
        if (model == null) return false;
        String normalized = model.toLowerCase(Locale.ROOT);
        return normalized.contains("claude-3-7")
            || normalized.contains("claude-sonnet-4")
            || normalized.contains("claude-opus-4")
            || normalized.contains("claude-haiku-4")
            || normalized.contains("claude-4");
    }

    private static boolean supportsReasoningEffortModel(String model) {
        if (model == null) return false;
        String normalized = model.toLowerCase(Locale.ROOT);
        return normalized.startsWith("gpt-5")
            || normalized.startsWith("o1")
            || normalized.startsWith("o3")
            || normalized.startsWith("o4");
    }

    public static boolean isCanonical(String value) {
        return value != null && CANONICAL.contains(normalize(value));
    }

    private static String normalize(String value) {
        return value.trim().toLowerCase(Locale.ROOT).replace('_', '-');
    }

    private static String normalizeProvider(String providerType) {
        return providerType == null ? "" : normalize(providerType);
    }

    private static boolean isAnthropic(String type) {
        return "anthropic".equals(type) || "claude".equals(type);
    }

    private static boolean isOpenAi(String type) {
        return "openai".equals(type) || "open-ai".equals(type);
    }

    private static boolean isLocal(String type) {
        return "ollama".equals(type)
            || "vllm".equals(type)
            || "llamacpp".equals(type)
            || "llama-cpp".equals(type)
            || "local".equals(type);
    }
}
