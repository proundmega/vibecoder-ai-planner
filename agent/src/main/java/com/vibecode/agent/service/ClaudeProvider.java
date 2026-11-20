package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Claude (Anthropic) AI provider implementation.
 * Uses the Anthropic Messages API.
 */
public class ClaudeProvider implements AiProvider {

    private static final String API_URL = "https://api.anthropic.com/v1/messages";
    private static final String DEFAULT_MODEL = "claude-sonnet-4-20250514";

    private final String apiKey;
    private final String model;
    private final String effort;
    private final boolean effortExplicit;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private int tokensIn = 0;
    private int tokensOut = 0;

    public ClaudeProvider(String apiKey, String model) {
        this(apiKey, model, null, false);
    }

    public ClaudeProvider(String apiKey, String model, String effort) {
        this(apiKey, model, effort, false);
    }

    public ClaudeProvider(String apiKey, String model, String effort, boolean effortExplicit) {
        this.apiKey = apiKey;
        this.model = model != null ? model : DEFAULT_MODEL;
        this.effort = ProviderEffort.canonical(effort);
        this.effortExplicit = effortExplicit;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String generateResponse(String systemPrompt, String userMessage) throws IOException {
        List<Map<String, Object>> messages = new ArrayList<>();
        Map<String, Object> msg = new HashMap<>();
        msg.put("role", "user");
        msg.put("content", userMessage);
        messages.add(msg);

        Map<String, Object> requestBody = new HashMap<>();
        // Extended thinking is only sent for a model that supports it, and
        // only when the runtime overrides the model default or the default is
        // already above medium. Older models reject the field.
        boolean thinking = ProviderEffort.supportsThinking(model)
            && (effortExplicit || !ProviderEffort.MEDIUM.equals(effort));
        int thinkingBudget = ProviderEffort.thinkingBudgetTokens(effort);
        requestBody.put("model", model);
        requestBody.put("max_tokens", thinking
            ? Math.max(4096, thinkingBudget + 1024)
            : 4096);
        requestBody.put("system", systemPrompt);
        requestBody.put("messages", messages);
        if (thinking) {
            requestBody.put("thinking", Map.of(
                "type", "enabled",
                "budget_tokens", thinkingBudget));
        }

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(API_URL)
            .header("x-api-key", apiKey)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .post(body)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                throw new IOException("Claude API error " + response.code() + ": " + errorBody);
            }

            String responseBody = response.body() != null ? response.body().string() : "";
            JsonNode root = objectMapper.readTree(responseBody);
            
            this.tokensIn = root.path("usage").path("input_tokens").asInt(0);
            this.tokensOut = root.path("usage").path("output_tokens").asInt(0);
            
            return extractText(root);
        }
    }

    /**
     * Anthropic returns thinking blocks before text blocks when extended
     * thinking is enabled. Join only the text blocks; never assume content[0]
     * is the answer.
     */
    static String extractText(JsonNode root) {
        JsonNode blocks = root.path("content");
        if (!blocks.isArray()) {
            return "";
        }
        StringBuilder text = new StringBuilder();
        for (JsonNode block : blocks) {
            if ("text".equals(block.path("type").asText())) {
                if (text.length() > 0) text.append('\n');
                text.append(block.path("text").asText());
            }
        }
        if (text.length() == 0) {
            // Some compatible endpoints omit the block type; keep the old
            // fallback rather than returning nothing.
            for (JsonNode block : blocks) {
                String value = block.path("text").asText("");
                if (!value.isBlank()) {
                    if (text.length() > 0) text.append('\n');
                    text.append(value);
                }
            }
        }
        return text.toString();
    }

    @Override
    public String getType() {
        return "claude";
    }

    @Override
    public int getTokensIn() {
        return tokensIn;
    }

    @Override
    public int getTokensOut() {
        return tokensOut;
    }
}
