package com.vibecode.agent.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.ApiResponse;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import okhttp3.*;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * HTTP client for communicating with the Vibecode backend API.
 * Handles authentication, request/response parsing, and error handling.
 */
public class ApiService {

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final AgentConfig config;
    private final String baseUrl;

    public ApiService(AgentConfig config) {
        this.config = config;
        this.baseUrl = config.getApiUrl();
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .readTimeout(java.time.Duration.ofSeconds(30))
            .writeTimeout(java.time.Duration.ofSeconds(30))
            .build();
    }

    /**
     * List available backlog tickets for the project.
     */
    public List<Ticket> listBacklogTickets() throws IOException {
        String url = baseUrl + "/tickets/project/" + config.getProjectId() + "?status=backlog";
        ApiResponse<List<Ticket>> response = executeGet(url, new TypeReference<ApiResponse<List<Ticket>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to list tickets: " + response.getError());
        }
        
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    /**
     * Pick up a ticket (assign to self, set status to in_progress).
     */
    public Ticket pickUpTicket(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/pickup";
        ApiResponse<Ticket> response = executePost(url, null, new TypeReference<ApiResponse<Ticket>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to pick up ticket " + ticketId + ": " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Release a ticket (clear ownership, set status back to backlog).
     */
    public Ticket releaseTicket(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/release";
        ApiResponse<Ticket> response = executePost(url, null, new TypeReference<ApiResponse<Ticket>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to release ticket " + ticketId + ": " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Update ticket status.
     */
    public Ticket updateTicketStatus(Long ticketId, String newStatus) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId;
        Map<String, String> body = Map.of("status", newStatus);
        ApiResponse<Ticket> response = executePut(url, body, new TypeReference<ApiResponse<Ticket>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to update ticket status: " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Post a message on a ticket.
     */
    public TicketMessage postMessage(Long ticketId, String messageType, String content) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/messages";
        Map<String, Object> body = Map.of(
            "messageType", messageType,
            "content", content
        );
        ApiResponse<TicketMessage> response = executePost(url, body, new TypeReference<ApiResponse<TicketMessage>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to post message: " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Get messages for a ticket.
     */
    public List<TicketMessage> getMessages(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/messages";
        ApiResponse<List<TicketMessage>> response = executeGet(url, new TypeReference<ApiResponse<List<TicketMessage>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get messages: " + response.getError());
        }
        
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    /**
     * Get decrypted API key for a provider type.
     */
    public String getDecryptedKey(String credentialType) throws IOException {
        String url = baseUrl + "/credentials/" + config.getProjectId() + "/credentials/decrypt?type=" + credentialType;
        ApiResponse<Map<String, String>> response = executeGet(url, new TypeReference<ApiResponse<Map<String, String>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get " + credentialType + " key: " + response.getError());
        }
        
        return response.getData() != null ? response.getData().get("key") : null;
    }

    private <T> ApiResponse<T> executeGet(String url, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        Request request = new Request.Builder()
            .url(url)
            .header("X-API-Key", config.getAgentApiKey())
            .get()
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(body, typeRef);
        }
    }

    private <T> ApiResponse<T> executePost(String url, Object body, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        String json = body != null ? objectMapper.writeValueAsString(body) : "{}";
        RequestBody requestBody = RequestBody.create(json, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(url)
            .header("X-API-Key", config.getAgentApiKey())
            .header("Content-Type", "application/json")
            .post(requestBody)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(responseBody, typeRef);
        }
    }

    private <T> ApiResponse<T> executePatch(String url, Object body, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        String json = body != null ? objectMapper.writeValueAsString(body) : "{}";
        RequestBody requestBody = RequestBody.create(json, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(url)
            .header("X-API-Key", config.getAgentApiKey())
            .header("Content-Type", "application/json")
            .patch(requestBody)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(responseBody, typeRef);
        }
    }

    private <T> ApiResponse<T> executePut(String url, Object body, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        String json = body != null ? objectMapper.writeValueAsString(body) : "{}";
        RequestBody requestBody = RequestBody.create(json, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(url)
            .header("X-API-Key", config.getAgentApiKey())
            .header("Content-Type", "application/json")
            .put(requestBody)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(responseBody, typeRef);
        }
    }

    /**
     * Send a heartbeat to the backend to indicate the agent is alive.
     */
    public void sendHeartbeat(String agentId, String currentTicketId, String currentStep,
                               Map<String, Object> memoryUsage, Map<String, Object> cpuUsage) throws IOException {
        String url = baseUrl + "/agents-status/" + agentId + "/heartbeat";
        Map<String, Object> body = new java.util.HashMap<>();
        if (currentTicketId != null) body.put("current_ticket_id", currentTicketId);
        if (currentStep != null) body.put("current_step", currentStep);
        if (memoryUsage != null) body.put("memory_usage", memoryUsage);
        if (cpuUsage != null) body.put("cpu_usage", cpuUsage);
        executePost(url, body, new TypeReference<ApiResponse<Object>>() {});
    }

    /**
     * Get decrypted provider config for this agent from the backend.
     */
    public Map<String, Object> getProviderConfig(String agentId) throws IOException {
        String url = baseUrl + "/v1/agents/" + agentId + "/provider-config";
        ApiResponse<Map<String, Object>> response = executeGet(url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get provider config: " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Return the underlying OkHttpClient for reuse (e.g., in TicketProcessor).
     */
    public OkHttpClient getHttpClient() {
        return httpClient;
    }

    /**
     * Report usage to the backend for billing/monitoring.
     */
    public void reportUsage(String agentId, String providerType, String model,
                             int tokensIn, int tokensOut, long durationMs, Long ticketId) throws IOException {
        reportUsage(agentId, providerType, model, tokensIn, tokensOut, durationMs, ticketId, null, null);
    }

    /**
     * Report usage to the backend for billing/monitoring with planning context.
     */
    public void reportUsage(String agentId, String providerType, String model,
                             int tokensIn, int tokensOut, long durationMs, Long ticketId,
                             String planningStage, List<String> fileKeys) throws IOException {
        String url = baseUrl + "/usage/agents/" + agentId + "/usage";
        
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("provider_type", providerType);
        body.put("model", model);
        body.put("tokens_in", tokensIn);
        body.put("tokens_out", tokensOut);
        body.put("duration_ms", durationMs);
        if (ticketId != null) body.put("ticket_id", ticketId);
        if (planningStage != null) body.put("planning_stage", planningStage);
        if (fileKeys != null && !fileKeys.isEmpty()) body.put("file_keys", fileKeys);
        
        executePost(url, body, new TypeReference<ApiResponse<Object>>() {});
    }
}
