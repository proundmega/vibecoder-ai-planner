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
        if (!config.usesEnrollment()) {
            return;
        }

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

    public String getAgentId() {
        AgentCredentialStore.Credentials current = credentials;
        return current != null ? current.agentId() : config.getAgentId();
    }

    /**
     * Token for the next API call. In legacy mode this is the static key; in
     * enrollment mode it refreshes shortly before expiry.
     */
    public synchronized String ensureValidAccessToken() throws IOException {
        AgentCredentialStore.Credentials current = credentials;
        if (current == null) {
            return config.getAgentApiKey();
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
            throw new IOException("Agent is authenticated with a static key; cannot refresh");
        }
        if (failedAccessToken != null && !failedAccessToken.equals(credentials.accessToken())) {
            return;
        }
        refresh();
    }

    private void enroll() throws IOException {
        AgentCredentialStore.Credentials enrolled = client.enroll(agentName(), nodeMetadata());
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
        AgentCredentialStore.Credentials rotated = client.refresh(
            current.refreshToken(), pendingRefreshKey);
        pendingRefreshKey = null;
        // Persist before adopting so a failed write cannot leave memory ahead
        // of disk (a restart would replay a rotated token and revoke the family).
        if (store != null) store.save(rotated);
        adopt(rotated);
    }

    private void adopt(AgentCredentialStore.Credentials next) {
        this.credentials = next;
        if (next.agentId() != null && !next.agentId().isBlank()) {
            config.setAgentId(next.agentId());
        }
        if (next.projectId() != null && !next.projectId().isBlank()) {
            config.setProjectId(next.projectId());
        }
        RedactionRegistry.register(next.accessToken(), next.refreshToken());
    }

    private static String agentName() {
        String explicit = System.getenv("AGENT_NAME");
        if (explicit != null && !explicit.isBlank()) return explicit;
        String host = hostname();
        return "agent-" + (host.isBlank() ? "node" : host);
    }

    private static Map<String, Object> nodeMetadata() {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("hostname", hostname());
        metadata.put("os", System.getProperty("os.name", "unknown"));
        metadata.put("java", System.getProperty("java.version", "unknown"));
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
