package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import okhttp3.*;

import java.io.IOException;
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
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ClaudeProvider(String apiKey, String model) {
        this.apiKey = apiKey;
        this.model = model != null ? model : DEFAULT_MODEL;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String generateResponse(String systemPrompt, String userMessage) throws IOException {
        String json = objectMapper.writeValueAsString(new Object[]{
            Map.of(
                "role", "user",
                "content", userMessage
            )
        });

        // Build the messages array
        java.util.List<java.util.Map<String, Object>> messages = new java.util.ArrayList<>();
        java.util.Map<String, String> msg = new java.util.HashMap<>();
        msg.put("role", "user");
        msg.put("content", userMessage);
        messages.add(msg);

        java.util.Map<String, Object> requestBody = new java.util.HashMap<>();
        requestBody.put("model", model);
        requestBody.put("max_tokens", 4096);
        requestBody.put("system", systemPrompt);
        requestBody.put("messages", messages);

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
            JsonNode content = root.path("content").get(0);
            return content.path("text").asText();
        }
    }

    @Override
    public String getType() {
        return "claude";
    }
}
