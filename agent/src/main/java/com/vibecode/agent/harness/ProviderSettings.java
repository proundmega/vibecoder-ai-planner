package com.vibecode.agent.harness;

/**
 * Resolved AI provider settings shared by the legacy agent and the harness.
 */
public record ProviderSettings(
    String type,
    String apiKey,
    String baseUrl,
    String model,
    int maxTokens
) {
    public String normalizedType() {
        return type == null ? "generic" : type.trim().toLowerCase().replace('_', '-');
    }

    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Records would otherwise print the API key. Keep diagnostics useful while
     * making an accidental log line safe.
     */
    @Override
    public String toString() {
        return "ProviderSettings["
            + "type=" + type
            + ", apiKey=" + (hasApiKey() ? "[REDACTED]" : "null")
            + ", baseUrl=" + baseUrl
            + ", model=" + model
            + ", maxTokens=" + maxTokens
            + ']';
    }
}
