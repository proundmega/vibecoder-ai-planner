package com.vibecode.agent.service;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.harness.RedactionRegistry;

import java.io.IOException;
import java.net.InetAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Owns the node access-token lifecycle: first-boot enrollment, credential
 * persistence, refresh before expiry and one refresh retry after a 401.
 *
 * <p>Refresh is single-flight: every caller is synchronized on this instance,
 * so a timer refresh and a 401-triggered refresh coalesce into one in-flight
 * request with one {@code idempotency_key}. The backend replay cache returns
 * the same pair for a retry with that key; presenting a rotated token with a
 * different key would revoke the family, so the key is retained until the new
 * pair is durable.</p>
 */
public class AgentAuthManager {

    private static final Duration REFRESH_MARGIN = Duration.ofMinutes(5);

    private final AgentConfig config;
    private final AgentCredentialStore store;
    private final AgentEnrollmentClient client;

    private volatile AgentCredentialStore.Credentials credentials;
    private String pendingRefreshKey;

    public AgentAuthManager(AgentConfig config, AgentCredentialStore store, AgentEnrollmentClient client) {
        this.config = config;
        this.store = store;
        this.client = client;
    }

    public synchronized void initialize() throws IOException {
        if (store != null && store.exists()) {
            adopt(store.load());
            return;
        }

        if (config.getEnrollmentToken() == null || config.getEnrollmentToken().isBlank()) {
            throw new IOException(
                "No credential file and no ENROLLMENT_TOKEN; mount AGENT_CREDENTIALS_FILE or mint a join token");
        }
        enroll();
    }

    public String getNodeId() {
        AgentCredentialStore.Credentials current = credentials;
        return current != null ? current.nodeId() : config.getNodeId();
    }

    /** Token for the next API call; refreshes shortly before expiry. */
    public synchronized String ensureValidAccessToken() throws IOException {
        AgentCredentialStore.Credentials current = credentials;
        if (current == null) {
            throw new IOException("Node credential is not initialized; enroll this node first");
        }
        if (current.accessToken() == null
                || current.accessExpiresAt() == null
                || Instant.now().isAfter(current.accessExpiresAt().minus(REFRESH_MARGIN))) {
            refresh();
            current = credentials;
        }
        return current.accessToken();
    }

    /**
     * Called once after a 401. A rotated/expired refresh token surfaces as an
     * IOException so the caller can exit non-zero instead of looping. If
     * another thread already refreshed the token that failed, this is a no-op.
     */
    public synchronized void refreshAfterUnauthorized(String failedAccessToken) throws IOException {
        if (credentials == null) {
            throw new IOException("Node credential is not initialized; cannot refresh");
        }
        if (failedAccessToken != null && !failedAccessToken.equals(credentials.accessToken())) {
            return;
        }
        refresh();
    }

    private void enroll() throws IOException {
        AgentCredentialStore.Credentials enrolled = client.enroll(nodeName(), nodeMetadata());
        // Persist first: if the volume is read-only/full, fail without
        // pretending the node has usable durable credentials.
        if (store != null) store.save(enrolled);
        adopt(enrolled);
    }

    private void refresh() throws IOException {
        AgentCredentialStore.Credentials current = credentials;
        if (current == null || current.refreshToken() == null) {
            throw new IOException("No refresh token available; re-enroll this node");
        }
        // Keep the same key across retries of this attempt (including lost
        // responses) so the backend replay cache can return the same pair.
        if (pendingRefreshKey == null) {
            pendingRefreshKey = java.util.UUID.randomUUID().toString();
        }
        AgentCredentialStore.Credentials rotated;
        try {
            rotated = client.refresh(current.refreshToken(), pendingRefreshKey);
        } catch (IOException error) {
            // Keep pendingRefreshKey so a retry of this same attempt can hit the
            // backend replay cache, then fail the process rather than looping.
            throw new AgentAuthFatalException(
                "Node credentials could not be refreshed; re-enroll this node", error);
        }
        // Persist before adopting so a failed write cannot leave memory ahead
        // of disk (a restart would replay a rotated token and revoke the family).
        if (store != null) store.save(rotated);
        adopt(rotated);
        // Clear only after the new pair is durable; a failed save retries with
        // the same key instead of presenting the rotated token under a new key.
        pendingRefreshKey = null;
    }

    private void adopt(AgentCredentialStore.Credentials next) {
        this.credentials = next;
        if (next.nodeId() != null && !next.nodeId().isBlank()) {
            config.setNodeId(next.nodeId());
        }
        RedactionRegistry.register(next.accessToken(), next.refreshToken());
    }

    private static String nodeName() {
        String explicit = System.getenv("AGENT_NODE_NAME");
        if (explicit == null || explicit.isBlank()) {
            explicit = System.getenv("AGENT_NAME");
        }
        if (explicit != null && !explicit.isBlank()) return explicit;
        String host = hostname();
        return host.isBlank() ? "node" : host;
    }

    private static Map<String, Object> nodeMetadata() {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("hostname", hostname());
        metadata.put("os", System.getProperty("os.name", "unknown"));
        metadata.put("java", System.getProperty("java.version", "unknown"));
        String fingerprint = System.getenv("AGENT_FINGERPRINT");
        if (fingerprint != null && !fingerprint.isBlank()) {
            metadata.put("fingerprint", fingerprint);
        }
        return metadata;
    }

    private static String hostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "";
        }
    }
}
