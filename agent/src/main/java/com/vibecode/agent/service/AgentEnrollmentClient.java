package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Exchanges a one-time join token for node credentials and rotates refresh
 * tokens. Mirrors the backend contract in fg-53 `02` → API contract.
 */
public class AgentEnrollmentClient {

    private static final MediaType JSON = MediaType.get("application/json");

    private final AgentConfig config;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AgentEnrollmentClient(AgentConfig config) {
        this(config, new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(10))
            .readTimeout(Duration.ofSeconds(30))
            .writeTimeout(Duration.ofSeconds(30))
            .build());
    }

    AgentEnrollmentClient(AgentConfig config, OkHttpClient httpClient) {
        this.config = config;
        this.httpClient = httpClient;
    }

    public AgentCredentialStore.Credentials enroll(String name, Map<String, Object> nodeMetadata)
            throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", config.getEnrollmentToken());
        body.put("name", name);
        body.put("node_metadata", nodeMetadata != null ? nodeMetadata : Map.of());
        return post(config.getEnrollmentUrl(), body);
    }

    public AgentCredentialStore.Credentials refresh(String refreshToken, String idempotencyKey)
            throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("refresh_token", refreshToken);
        body.put("idempotency_key", idempotencyKey);
        return postWithRetry(config.getRefreshUrl(), body);
    }

    /**
     * A lost refresh response is retried with the same idempotency key so the
     * backend replay cache returns the identical pair instead of treating the
     * rotated token as theft.
     */
    private AgentCredentialStore.Credentials postWithRetry(String url, Map<String, Object> body)
            throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                return post(url, body);
            } catch (IOException error) {
                last = error;
                if (attempt < 3) {
                    try {
                        Thread.sleep(200L * attempt);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        throw error;
                    }
                }
            }
        }
        throw last != null ? last : new IOException("Refresh request failed");
    }

    private AgentCredentialStore.Credentials post(String url, Map<String, Object> body) throws IOException {
        requireSecureUrl(url);

        Request request = new Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .post(RequestBody.create(objectMapper.writeValueAsString(body), JSON))
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String text = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                throw new IOException("Enrollment request failed with HTTP " + response.code());
            }
            JsonNode root = objectMapper.readTree(text);
            JsonNode data = root.path("data");
            if (!root.path("success").asBoolean(false) || data.isMissingNode()) {
                throw new IOException("Enrollment request was rejected");
            }
            return new AgentCredentialStore.Credentials(
                data.path("agent_id").asText(),
                data.path("access_token").asText(),
                data.path("refresh_token").asText(),
                parseInstant(data.path("access_expires_at")),
                parseInstant(data.path("refresh_expires_at")),
                data.path("project_id").isMissingNode() ? null : data.path("project_id").asText());
        }
    }

    private static Instant parseInstant(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return null;
        try {
            return Instant.parse(node.asText());
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * Refuse to send bearer credentials over plain HTTP unless the target is
     * loopback or the operator explicitly opted in for local testing.
     */
    private static void requireSecureUrl(String url) throws IOException {
        if ("1".equals(System.getenv("ALLOW_INSECURE_AGENT_ENROLLMENT"))) return;
        URI uri = URI.create(url);
        if ("https".equalsIgnoreCase(uri.getScheme())) return;
        String host = uri.getHost();
        if ("localhost".equals(host) || "127.0.0.1".equals(host) || "::1".equals(host)) return;
        throw new IOException("Enrollment requires HTTPS for non-loopback hosts");
    }
}
