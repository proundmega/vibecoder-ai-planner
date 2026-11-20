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
 * Exchanges a one-time node join token for node credentials and rotates the
 * refresh token. Mirrors the fg-54 API contract
 * ({@code POST /agent-nodes/enroll} and {@code POST /agent-nodes/refresh}).
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

    /**
     * Enrolls the host. The request has no project, role or provider field;
     * those are server-side concepts after fg-54.
     */
    public AgentCredentialStore.Credentials enroll(String name, Map<String, Object> nodeMetadata)
            throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", config.getEnrollmentToken());
        body.put("name", name);
        if (nodeMetadata != null) {
            if (nodeMetadata.get("hostname") != null) {
                body.put("hostname", nodeMetadata.get("hostname"));
            }
            if (nodeMetadata.get("fingerprint") != null) {
                body.put("fingerprint", nodeMetadata.get("fingerprint"));
            }
        }
        return post(config.getEnrollmentUrl(), body, null);
    }

    public AgentCredentialStore.Credentials refresh(String refreshToken, String idempotencyKey)
            throws IOException {
        return refresh(refreshToken, idempotencyKey, null);
    }

    /**
     * Refresh the pair. The backend's refresh payload deliberately omits the
     * node id (the credential already identifies the node), so the caller
     * supplies the current node id as a fallback.
     */
    public AgentCredentialStore.Credentials refresh(String refreshToken, String idempotencyKey,
                                                    String currentNodeId) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("refresh_token", refreshToken);
        body.put("idempotency_key", idempotencyKey);
        return postWithRetry(config.getRefreshUrl(), body, currentNodeId);
    }

    /**
     * A lost refresh response is retried with the same idempotency key so the
     * backend replay cache returns the identical pair instead of treating the
     * rotated token as theft.
     */
    private AgentCredentialStore.Credentials postWithRetry(String url, Map<String, Object> body,
                                                           String fallbackNodeId)
            throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                return post(url, body, fallbackNodeId);
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

    private AgentCredentialStore.Credentials post(String url, Map<String, Object> body,
                                                  String fallbackNodeId) throws IOException {
        requireSecureUrl(url);

        Request request = new Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .post(RequestBody.create(objectMapper.writeValueAsString(body), JSON))
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String text = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                throw new IOException("Node enrollment request failed with HTTP " + response.code());
            }
            JsonNode root = objectMapper.readTree(text);
            JsonNode data = root.path("data");
            if (!root.path("success").asBoolean(false) || data.isMissingNode()) {
                throw new IOException("Node enrollment request was rejected");
            }
            String nodeId = firstText(data, "nodeId", "node_id");
            if (nodeId == null) {
                JsonNode node = data.path("node");
                nodeId = firstText(node, "id", "nodeId", "node_id");
            }
            if (nodeId == null || nodeId.isBlank()) {
                nodeId = fallbackNodeId;
            }
            if (nodeId == null || nodeId.isBlank()) {
                throw new IOException("Node enrollment response did not include a node id");
            }
            String accessToken = firstText(data, "accessToken", "access_token");
            String refreshToken = firstText(data, "refreshToken", "refresh_token");
            if (accessToken == null || refreshToken == null) {
                throw new IOException("Node enrollment response did not include both tokens");
            }
            Instant accessExpiresAt = firstInstant(data, "accessExpiresAt", "access_expires_at");
            Instant refreshExpiresAt = firstInstant(data, "refreshExpiresAt", "refresh_expires_at");
            return new AgentCredentialStore.Credentials(
                nodeId,
                accessToken,
                refreshToken,
                accessExpiresAt != null ? accessExpiresAt : Instant.now().plus(Duration.ofHours(1)),
                refreshExpiresAt != null ? refreshExpiresAt : Instant.now().plus(Duration.ofDays(30)));
        }
    }

    private static String firstText(JsonNode node, String... fields) {
        if (node == null || node.isMissingNode()) return null;
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value != null && !value.isNull() && !value.asText().isBlank()) {
                return value.asText();
            }
        }
        return null;
    }

    private static Instant firstInstant(JsonNode node, String... fields) {
        String text = firstText(node, fields);
        if (text == null) return null;
        try {
            return Instant.parse(text);
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
