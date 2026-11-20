package com.vibecode.agent.service;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.harness.RedactionRegistry;

import java.io.IOException;
import java.net.InetAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Owns the node access-token lifecycle: first-boot enrollment, credential
 * persistence, refresh before expiry and one refresh retry after a 401.
 *
 * <p><b>Host-safe refresh.</b> The supervisor and all of its children share one
 * credential file. A refresh rotates the node's refresh token and the backend
 * revokes the whole family if a rotated token is presented with a different
 * idempotency key. This class therefore takes an OS file lock around the
 * read/reload/refresh/write sequence and persists the idempotency key in the
 * credential file. The first process rotates; every other process reloads the
 * new pair (or replays the same key after a lost response) instead of racing
 * with a new key.</p>
 */
public class AgentAuthManager {

    private static final Duration REFRESH_MARGIN = Duration.ofMinutes(5);

    private final AgentConfig config;
    private final AgentCredentialStore store;
    private final AgentEnrollmentClient client;

    private volatile AgentCredentialStore.Credentials credentials;
    private String inMemoryRefreshKey;

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
        if (needsRefresh(current)) {
            refresh(false, null);
            current = credentials;
        }
        return current.accessToken();
    }

    /**
     * Called once after a 401. A rotated/expired refresh token surfaces as an
     * IOException so the caller can exit non-zero instead of looping. If
     * another process already refreshed the token that failed, this adopts the
     * new pair without a network call.
     */
    public synchronized void refreshAfterUnauthorized(String failedAccessToken) throws IOException {
        if (credentials == null) {
            throw new IOException("Node credential is not initialized; cannot refresh");
        }
        if (failedAccessToken != null && !failedAccessToken.equals(credentials.accessToken())) {
            return;
        }
        refresh(true, failedAccessToken);
    }

    private void enroll() throws IOException {
        AgentCredentialStore.Credentials enrolled = client.enroll(nodeName(), nodeMetadata());
        AgentCredentialStore.Credentials withKey = new AgentCredentialStore.Credentials(
            enrolled.nodeId(),
            enrolled.accessToken(),
            enrolled.refreshToken(),
            enrolled.accessExpiresAt(),
            enrolled.refreshExpiresAt(),
            UUID.randomUUID().toString());
        // Persist first: if the volume is read-only/full, fail without
        // pretending the node has usable durable credentials.
        if (store != null) store.save(withKey);
        adopt(withKey);
    }

    private void refresh(boolean force, String failedAccessToken) throws IOException {
        if (store == null) {
            refreshInMemory(force, failedAccessToken);
            return;
        }
        store.withLock(() -> {
            refreshLocked(force, failedAccessToken);
            return null;
        });
    }

    private void refreshLocked(boolean force, String failedAccessToken) throws IOException {
        AgentCredentialStore.Credentials current = credentials;

        // Another process may have rotated while we waited for the lock.
        if (store.exists()) {
            AgentCredentialStore.Credentials disk = store.load();
            if (isNewer(disk, current)) {
                adopt(disk);
                current = disk;
            }
        }

        if (current == null || current.refreshToken() == null) {
            throw new IOException("No refresh token available; re-enroll this node");
        }

        boolean adoptedAnotherProcessesPair = force
            && failedAccessToken != null
            && current.accessToken() != null
            && !failedAccessToken.equals(current.accessToken())
            && !needsRefresh(current);
        if (adoptedAnotherProcessesPair) {
            return;
        }
        if (!force && !needsRefresh(current)) {
            return;
        }

        // Persist the key before the network call so a crash/retry (or a
        // surviving process) replays the same key instead of minting a new one.
        String key = current.refreshKey();
        if (key == null || key.isBlank()) {
            key = inMemoryRefreshKey;
        }
        if (key == null || key.isBlank()) {
            key = UUID.randomUUID().toString();
        }
        inMemoryRefreshKey = key;
        current = new AgentCredentialStore.Credentials(
            current.nodeId(), current.accessToken(), current.refreshToken(),
            current.accessExpiresAt(), current.refreshExpiresAt(), key);
        try {
            store.save(current);
            adopt(current);
        } catch (IOException saveError) {
            // The network call can still succeed; keep the key in memory so a
            // retry after the volume recovers replays it.
            adopt(current);
        }

        AgentCredentialStore.Credentials rotated;
        try {
            rotated = client.refresh(current.refreshToken(), key, current.nodeId());
        } catch (IOException error) {
            // Keep the persisted key so a retry of this same attempt can hit
            // the backend replay cache, then fail the process rather than loop.
            throw new AgentAuthFatalException(
                "Node credentials could not be refreshed; re-enroll this node", error);
        }

        AgentCredentialStore.Credentials next = new AgentCredentialStore.Credentials(
            rotated.nodeId() != null && !rotated.nodeId().isBlank()
                ? rotated.nodeId() : current.nodeId(),
            rotated.accessToken(),
            rotated.refreshToken(),
            rotated.accessExpiresAt(),
            rotated.refreshExpiresAt(),
            UUID.randomUUID().toString());
        // Persist before adopting so a failed write cannot leave memory ahead
        // of disk (a restart would replay a rotated token under a new key).
        store.save(next);
        adopt(next);
        inMemoryRefreshKey = null;
    }

    private void refreshInMemory(boolean force, String failedAccessToken) throws IOException {
        AgentCredentialStore.Credentials current = credentials;
        if (current == null || current.refreshToken() == null) {
            throw new IOException("No refresh token available; re-enroll this node");
        }
        if (!force && !needsRefresh(current)) {
            return;
        }
        if (force && failedAccessToken != null
                && current.accessToken() != null
                && !failedAccessToken.equals(current.accessToken())) {
            return;
        }
        if (inMemoryRefreshKey == null || inMemoryRefreshKey.isBlank()) {
            inMemoryRefreshKey = UUID.randomUUID().toString();
        }
        AgentCredentialStore.Credentials rotated;
        try {
            rotated = client.refresh(current.refreshToken(), inMemoryRefreshKey);
        } catch (IOException error) {
            throw new AgentAuthFatalException(
                "Node credentials could not be refreshed; re-enroll this node", error);
        }
        adopt(new AgentCredentialStore.Credentials(
            rotated.nodeId() != null && !rotated.nodeId().isBlank()
                ? rotated.nodeId() : current.nodeId(),
            rotated.accessToken(),
            rotated.refreshToken(),
            rotated.accessExpiresAt(),
            rotated.refreshExpiresAt(),
            null));
        inMemoryRefreshKey = null;
    }

    private static boolean needsRefresh(AgentCredentialStore.Credentials credentials) {
        return credentials.accessToken() == null
            || credentials.accessExpiresAt() == null
            || Instant.now().isAfter(credentials.accessExpiresAt().minus(REFRESH_MARGIN));
    }

    private static boolean isNewer(AgentCredentialStore.Credentials disk,
                                   AgentCredentialStore.Credentials memory) {
        if (disk == null) return false;
        if (memory == null) return true;
        if (!Objects.equals(disk.accessToken(), memory.accessToken())) return true;
        if (disk.accessExpiresAt() == null) return false;
        return memory.accessExpiresAt() == null || disk.accessExpiresAt().isAfter(memory.accessExpiresAt());
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
