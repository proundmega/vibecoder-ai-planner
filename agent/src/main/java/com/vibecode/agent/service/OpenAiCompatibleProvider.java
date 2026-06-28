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
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public OpenAiCompatibleProvider(String endpointUrl, String model, String apiKey) {
        this.endpointUrl = endpointUrl;
        this.model = model != null ? model : "default";
        this.apiKey = apiKey;
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
        requestBody.put("max_tokens", 4096);
        requestBody.put("temperature", 0.2);

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request.Builder requestBuilder = new Request.Builder()
            .url(endpointUrl + "/chat/completions")
            .header("Content-Type", "application/json")
            .post(body);

        // Only add Authorization header if apiKey is set
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
            
            // Try standard OpenAI format: choices[0].message.content
            JsonNode choices = root.path("choices");
            if (choices.isArray() && choices.size() > 0) {
                JsonNode content = choices.get(0).path("message").path("content");
                if (content.isTextual()) {
                    return content.asText();
                }
            }
            
            // Fallback for some servers that return choices[0].text
            if (choices.isArray() && choices.size() > 0) {
                JsonNode text = choices.get(0).path("text");
                if (text.isTextual()) {
                    return text.asText();
                }
            }

            throw new IOException("Could not parse AI response - no content found in choices");
        }
    }

    @Override
    public String getType() {
        return "openai-compatible";
    }
}
