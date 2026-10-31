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
}
