package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.ApiService;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Fetches the planning documents attached to a ticket.
 */
public final class PlanningDocFetcher {

    private static final Logger log = LoggerFactory.getLogger(PlanningDocFetcher.class);

    private final ApiService apiService;
    private final AgentConfig config;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public PlanningDocFetcher(ApiService apiService, AgentConfig config) {
        this.apiService = apiService;
        this.config = config;
    }

    public List<String> fetch(Long ticketId) {
        List<String> docs = new ArrayList<>();
        try {
            String url = config.getApiUrl() + "/tickets/" + ticketId + "/planning";
            Request request = new Request.Builder()
                .url(url)
                .header("X-API-Key", config.getAgentApiKey())
                .header("Accept", "application/json")
                .get()
                .build();

            try (Response response = apiService.getHttpClient().newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null) {
                    log.warn("Could not fetch planning docs for ticket {}: HTTP {}",
                        ticketId, response.code());
                    return docs;
                }
                JsonNode root = objectMapper.readTree(response.body().string());
                JsonNode files = root.path("data");
                if (!files.isArray()) {
                    log.warn("Planning docs response for ticket {} has no data array", ticketId);
                    return docs;
                }
                for (JsonNode file : files) {
                    String fileKey = file.path("file_key").asText("");
                    String content = file.path("content").asText("");
                    docs.add("=== " + fileKey + " ===\n" + content);
                }
            }
        } catch (Exception e) {
            // Planning docs are optional; the ticket prompt still works without
            // them, but a silent failure makes missing docs hard to diagnose.
            log.warn("Failed to fetch planning docs for ticket {}: {}", ticketId, e.getMessage());
        }
        return docs;
    }
}
