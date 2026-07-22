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
 * OpenAI-compatible provider implementation.
 * Works with any server that implements the OpenAI chat completions API format:
 * Ollama, vLLM, llama.cpp, LocalAI, LM Studio, etc.
 */
public class OpenAiCompatibleProvider implements AiProvider {

    private final String endpointUrl;
    private final String model;
    private final String apiKey;
    private final int maxTokens;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private int tokensIn = 0;
    private int tokensOut = 0;

    public OpenAiCompatibleProvider(String endpointUrl, String model, String apiKey, int maxTokens) {
        this.endpointUrl = endpointUrl;
        this.model = model != null ? model : "default";
        this.apiKey = apiKey;
        this.maxTokens = maxTokens;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String generateResponse(String systemPrompt, String userMessage) throws IOException {
        List<Map<String, String>> messages = new ArrayList<>();

        Map<String, String> systemMsg = new HashMap<>();
        systemMsg.put("role", "system");
        systemMsg.put("content", systemPrompt);
        messages.add(systemMsg);

        Map<String, String> userMsg = new HashMap<>();
        userMsg.put("role", "user");
        userMsg.put("content", userMessage);
        messages.add(userMsg);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", model);
        requestBody.put("messages", messages);
        requestBody.put("max_tokens", maxTokens);
        requestBody.put("temperature", 0.2);

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request.Builder requestBuilder = new Request.Builder()
            .url(endpointUrl + "/chat/completions")
            .header("Content-Type", "application/json")
            .post(body);

        if (apiKey != null && !apiKey.isBlank()) {
            requestBuilder.header("Authorization", "Bearer " + apiKey);
        }

        Request request = requestBuilder.build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                throw new IOException("AI endpoint error " + response.code() + ": " + errorBody);
            }

            String responseBody = response.body() != null ? response.body().string() : "";
            JsonNode root = objectMapper.readTree(responseBody);
            
            JsonNode choices = root.path("choices");
            String content = null;
            
            if (choices.isArray() && choices.size() > 0) {
                JsonNode contentNode = choices.get(0).path("message").path("content");
                if (contentNode.isTextual()) {
                    content = contentNode.asText();
                }
            }
            
            if (content == null && choices.isArray() && choices.size() > 0) {
                JsonNode text = choices.get(0).path("text");
                if (text.isTextual()) {
                    content = text.asText();
                }
            }
            
            if (content == null) {
                throw new IOException("Could not parse AI response - no content found in choices");
            }
            
            JsonNode usage = root.path("usage");
            this.tokensIn = usage.path("prompt_tokens").asInt(0);
            this.tokensOut = usage.path("completion_tokens").asInt(0);
            
            return content;
        }
    }

    @Override
    public String getType() {
        return "openai-compatible";
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
