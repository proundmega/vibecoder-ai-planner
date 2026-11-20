package com.vibecode.agent.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Node/runtime API for fg-54.
 *
 * <p>Every call authenticates with the node credential. Runtime-scoped calls
 * also send {@code X-Agent-Runtime}; the backend binds the header to a runtime
 * owned by the presented node. No project or role is asserted by the client.</p>
 */
public class RuntimeApi {

    private static final Logger log = LoggerFactory.getLogger(RuntimeApi.class);
    private static final MediaType JSON = MediaType.get("application/json");

    private final AgentConfig config;
    private final AgentAuthManager authManager;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public RuntimeApi(AgentConfig config, AgentAuthManager authManager) {
        this(config, authManager, new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(10))
            .readTimeout(Duration.ofSeconds(30))
            .writeTimeout(Duration.ofSeconds(30))
            .build());
    }

    RuntimeApi(AgentConfig config, AgentAuthManager authManager, OkHttpClient httpClient) {
        this.config = config;
        this.authManager = authManager;
        this.httpClient = httpClient;
    }

    public String nodeId() {
        return authManager != null ? authManager.getNodeId() : null;
    }

    /** GET /agent-nodes/:id/config — resolved runtimes, grants and model refs, no secrets. */
    public Map<String, Object> fetchConfig() throws IOException {
        return fetchConfig(requireNodeId());
    }

    public Map<String, Object> fetchConfig(String nodeId) throws IOException {
        Request request = new Request.Builder()
            .url(config.getApiUrl() + "/agent-nodes/" + encode(nodeId) + "/config")
            .get()
            .build();
        return execute(request, new TypeReference<Map<String, Object>>() {});
    }

    /** POST /agent-nodes/:id/runtimes — declare the supervisor's desired set. */
    public List<Map<String, Object>> declareRuntimes(List<Map<String, Object>> declared) throws IOException {
        String nodeId = requireNodeId();
        Request request = new Request.Builder()
            .url(config.getApiUrl() + "/agent-nodes/" + encode(nodeId) + "/runtimes")
            .post(jsonBody(declared))
            .build();
        Object data = execute(request, new TypeReference<Object>() {});
        if (data instanceof List<?> list) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rows = (List<Map<String, Object>>) list;
            return rows;
        }
        if (data instanceof Map<?, ?> map && map.get("runtimes") instanceof List<?> list) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rows = (List<Map<String, Object>>) list;
            return rows;
        }
        return Collections.emptyList();
    }

    /**
     * GET /agent-nodes/:id/runtimes/:runtimeId/provider-config — the only
     * plaintext secret path. The response is per-run and no-store.
     */
    public Map<String, Object> fetchProviderConfig(String runtimeId) throws IOException {
        String nodeId = requireNodeId();
        Request request = new Request.Builder()
            .url(config.getApiUrl() + "/agent-nodes/" + encode(nodeId)
                + "/runtimes/" + encode(runtimeId) + "/provider-config")
            .header("X-Agent-Runtime", runtimeId)
            .header("Cache-Control", "no-store")
            .get()
            .build();
        return execute(request, new TypeReference<Map<String, Object>>() {});
    }

    /** POST /agent-runtimes/:id/heartbeat. */
    public void heartbeat(String runtimeId, String status, Object currentProjectId) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        if (status != null) body.put("status", status);
        if (currentProjectId != null) body.put("currentProjectId", currentProjectId);
        Request request = new Request.Builder()
            .url(config.getApiUrl() + "/agent-runtimes/" + encode(runtimeId) + "/heartbeat")
            .header("X-Agent-Runtime", runtimeId)
            .post(jsonBody(body))
            .build();
        execute(request, new TypeReference<Object>() {});
    }

    /** PATCH /agent-runtimes/:id — used by the supervisor to report drain/stop. */
    public Map<String, Object> patchRuntime(String runtimeId, Map<String, Object> updates) throws IOException {
        Request request = new Request.Builder()
            .url(config.getApiUrl() + "/agent-runtimes/" + encode(runtimeId))
            .header("X-Agent-Runtime", runtimeId)
            .patch(jsonBody(updates))
            .build();
        return execute(request, new TypeReference<Map<String, Object>>() {});
    }

    private String requireNodeId() throws IOException {
        String nodeId = nodeId();
        if (nodeId == null || nodeId.isBlank()) {
            throw new IOException("Node credential is not initialized");
        }
        return nodeId;
    }

    private RequestBody jsonBody(Object body) throws IOException {
        return RequestBody.create(objectMapper.writeValueAsString(body), JSON);
    }

    private <T> T execute(Request request, TypeReference<T> type) throws IOException {
        String token = authManager != null ? authManager.ensureValidAccessToken() : null;
        if (token == null || token.isBlank()) {
            throw new IOException("Node credential is not initialized");
        }
        Response response = send(request, token);
        if (response.code() == 401) {
            response.close();
            authManager.refreshAfterUnauthorized(token);
            String refreshed = authManager.ensureValidAccessToken();
            response = send(request, refreshed);
        }
        try (Response closed = response) {
            String text = closed.body() != null ? closed.body().string() : "";
            if (!closed.isSuccessful()) {
                throw new IOException("Runtime API request failed with HTTP " + closed.code());
            }
            if (text.isBlank()) {
                @SuppressWarnings("unchecked")
                T empty = (T) Collections.emptyMap();
                return empty;
            }
            Map<String, Object> root = objectMapper.readValue(text, new TypeReference<Map<String, Object>>() {});
            Object data = root.containsKey("data") ? root.get("data") : root;
            return objectMapper.convertValue(data, type);
        }
    }

    private Response send(Request request, String token) throws IOException {
        Request authenticated = request.newBuilder()
            .header("X-API-Key", token)
            .header("Accept", "application/json")
            .build();
        log.debug("Runtime API {} {}", authenticated.method(), authenticated.url().encodedPath());
        return httpClient.newCall(authenticated).execute();
    }

    private static String encode(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }
}
