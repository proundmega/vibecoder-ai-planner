package com.vibecode.agent.enrollment;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.AgentAuthManager;
import com.vibecode.agent.service.AgentCredentialStore;
import com.vibecode.agent.service.AgentEnrollmentClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class AgentAuthManagerTest {

    @TempDir
    Path tempDir;

    static class EnrollConfig extends AgentConfig {
        String token;
        String url;
        String file;

        @Override public boolean usesEnrollment() { return true; }
        @Override public String getEnrollmentToken() { return token; }
        @Override public String getEnrollmentUrl() { return url; }
        @Override public String getRefreshUrl() { return url; }
        @Override public String getCredentialsFile() { return file; }
    }

    static class StubClient extends AgentEnrollmentClient {
        final AtomicInteger enrolls = new AtomicInteger();
        final AtomicInteger refreshes = new AtomicInteger();
        final java.util.List<String> keys = new java.util.ArrayList<>();
        boolean failNextRefresh;
        boolean alwaysFailRefresh;
        AgentCredentialStore.Credentials next;

        StubClient(AgentConfig config) { super(config); }

        @Override
        public AgentCredentialStore.Credentials enroll(String name, Map<String, Object> metadata) {
            enrolls.incrementAndGet();
            return next;
        }

        @Override
        public AgentCredentialStore.Credentials refresh(String refreshToken, String idempotencyKey)
                throws IOException {
            refreshes.incrementAndGet();
            keys.add(idempotencyKey);
            try {
                Thread.sleep(30);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            if (alwaysFailRefresh) {
                throw new IOException("backend unavailable");
            }
            if (failNextRefresh) {
                failNextRefresh = false;
                throw new IOException("simulated lost response");
            }
            return next;
        }
    }

    static class FailingStore extends AgentCredentialStore {
        boolean fail;

        FailingStore(Path path) { super(path); }

        @Override
        public void save(AgentCredentialStore.Credentials credentials) throws IOException {
            if (fail) throw new IOException("read-only volume");
            super.save(credentials);
        }
    }

    private AgentCredentialStore.Credentials pair(String access, Instant accessExpiry) {
        return new AgentCredentialStore.Credentials(
            "42", access, "ar_refresh", accessExpiry, Instant.parse("2026-12-01T00:00:00Z"), "3");
    }

    @Test
    void firstBootEnrollsAndPersistsTheCredentialFile() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_first", Instant.parse("2026-01-01T00:00:00Z"));

        AgentAuthManager manager = new AgentAuthManager(
            config, new AgentCredentialStore(file), client);
        manager.initialize();

        assertEquals(1, client.enrolls.get());
        assertEquals("42", config.getAgentId());
        assertEquals("at_first", manager.ensureValidAccessToken());
        assertTrue(new AgentCredentialStore(file).exists());
    }

    @Test
    void restartWithAVolumeDoesNotEnrollAgain() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_first", Instant.parse("2026-01-01T00:00:00Z"));

        new AgentAuthManager(config, new AgentCredentialStore(file), client).initialize();
        assertEquals(1, client.enrolls.get());

        EnrollConfig restarted = new EnrollConfig();
        restarted.token = "enr_once";
        StubClient second = new StubClient(restarted);
        new AgentAuthManager(restarted, new AgentCredentialStore(file), second).initialize();

        assertEquals(0, second.enrolls.get());
        assertEquals("42", restarted.getAgentId());
    }

    @Test
    void refreshesShortlyBeforeAccessTokenExpiry() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_expiring", Instant.now().plusSeconds(30));

        AgentAuthManager manager = new AgentAuthManager(
            config, new AgentCredentialStore(file), client);
        manager.initialize();
        manager.ensureValidAccessToken();

        assertEquals(1, client.refreshes.get());
    }

    @Test
    void reusesTheIdempotencyKeyAfterALostRefreshResponse() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_expiring", Instant.now().plusSeconds(30));
        client.failNextRefresh = true;

        AgentAuthManager manager = new AgentAuthManager(
            config, new AgentCredentialStore(file), client);
        manager.initialize();

        assertThrows(IOException.class, manager::ensureValidAccessToken);
        manager.ensureValidAccessToken();

        assertEquals(client.keys.size(), 2);
        assertEquals(client.keys.get(0), client.keys.get(1));
    }

    @Test
    void keepsTheIdempotencyKeyWhenTheCredentialWriteFails() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_expiring", Instant.now().plusSeconds(30));
        FailingStore store = new FailingStore(file);

        AgentAuthManager manager = new AgentAuthManager(config, store, client);
        manager.initialize();

        store.fail = true;
        assertThrows(IOException.class, manager::ensureValidAccessToken);
        store.fail = false;
        manager.ensureValidAccessToken();

        assertEquals(2, client.keys.size());
        assertEquals(client.keys.get(0), client.keys.get(1));
    }

    @Test
    void throwsAFatalAuthErrorWhenRefreshCannotBeRetried() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_expiring", Instant.now().plusSeconds(30));
        client.alwaysFailRefresh = true;

        AgentAuthManager manager = new AgentAuthManager(
            config, new AgentCredentialStore(file), client);
        manager.initialize();

        assertThrows(com.vibecode.agent.service.AgentAuthFatalException.class,
            manager::ensureValidAccessToken);
    }

    @Test
    void coalescesSimultaneousRefreshTriggersIntoOneRequest() throws Exception {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_expiring", Instant.now().plusSeconds(30));
        AgentAuthManager manager = new AgentAuthManager(
            config, new AgentCredentialStore(file), client);
        manager.initialize();

        client.next = pair("at_fresh", Instant.now().plusSeconds(3600));
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        java.util.concurrent.CountDownLatch start = new java.util.concurrent.CountDownLatch(1);
        java.util.List<java.util.concurrent.Future<String>> futures = new java.util.ArrayList<>();
        for (int i = 0; i < 2; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                return manager.ensureValidAccessToken();
            }));
        }
        start.countDown();
        assertEquals("at_fresh", futures.get(0).get());
        assertEquals("at_fresh", futures.get(1).get());
        pool.shutdownNow();

        assertEquals(1, client.refreshes.get());
        assertEquals(1, client.keys.size());
    }

    @Test
    void refreshesOnceAfterAnUnauthorizedResponse() throws IOException {
        EnrollConfig config = new EnrollConfig();
        config.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient client = new StubClient(config);
        client.next = pair("at_still_valid", Instant.now().plusSeconds(3600));

        AgentAuthManager manager = new AgentAuthManager(
            config, new AgentCredentialStore(file), client);
        manager.initialize();

        manager.refreshAfterUnauthorized("at_still_valid");
        assertEquals(1, client.refreshes.get());
    }
}
