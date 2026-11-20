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
            return refresh(refreshToken, idempotencyKey, null);
        }

        @Override
        public AgentCredentialStore.Credentials refresh(String refreshToken, String idempotencyKey,
                                                        String currentNodeId)
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
            "42", access, "ar_refresh", accessExpiry, Instant.parse("2026-12-01T00:00:00Z"));
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
        assertEquals("42", config.getNodeId());
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
        assertEquals("42", restarted.getNodeId());
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
    void twoRuntimeManagersShareOneHostRefreshAndDoNotRevokeTheFamily() throws IOException {
        EnrollConfig firstConfig = new EnrollConfig();
        firstConfig.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient firstClient = new StubClient(firstConfig);
        firstClient.next = pair("at_expiring", Instant.now().plusSeconds(30));

        AgentAuthManager first = new AgentAuthManager(
            firstConfig, new AgentCredentialStore(file), firstClient);
        first.initialize();

        EnrollConfig secondConfig = new EnrollConfig();
        secondConfig.token = "enr_once";
        StubClient secondClient = new StubClient(secondConfig);
        AgentAuthManager second = new AgentAuthManager(
            secondConfig, new AgentCredentialStore(file), secondClient);
        second.initialize();

        firstClient.next = pair("at_rotated", Instant.now().plusSeconds(3600));
        String firstToken = first.ensureValidAccessToken();
        String secondToken = second.ensureValidAccessToken();

        assertEquals(1, firstClient.refreshes.get(), "the first process rotates once");
        assertEquals(0, secondClient.refreshes.get(), "the second process reloads the rotated pair");
        assertEquals(firstToken, secondToken);
        assertEquals("42", second.getNodeId());
    }

    @Test
    void aSecondProcessAfterA401AdoptsAnotherProcessesRotatedPair() throws IOException {
        EnrollConfig firstConfig = new EnrollConfig();
        firstConfig.token = "enr_once";
        Path file = tempDir.resolve("credentials.json");
        StubClient firstClient = new StubClient(firstConfig);
        firstClient.next = pair("at_expiring", Instant.now().plusSeconds(30));
        AgentAuthManager first = new AgentAuthManager(
            firstConfig, new AgentCredentialStore(file), firstClient);
        first.initialize();

        // A second process writes a valid pair (simulating its earlier
        // refresh), then loads it like a normal child.
        new AgentCredentialStore(file).save(pair("at_second", Instant.now().plusSeconds(3600)));
        EnrollConfig secondConfig = new EnrollConfig();
        secondConfig.token = "enr_once";
        StubClient secondClient = new StubClient(secondConfig);
        AgentAuthManager second = new AgentAuthManager(
            secondConfig, new AgentCredentialStore(file), secondClient);
        second.initialize();
        String stale = second.ensureValidAccessToken();
        assertEquals("at_second", stale);
        int secondRefreshes = secondClient.refreshes.get();

        // The first process adopts the on-disk pair, then rotates it.
        assertEquals("at_second", first.ensureValidAccessToken());
        firstClient.next = pair("at_rotated", Instant.now().plusSeconds(3600));
        first.refreshAfterUnauthorized("at_second");

        // The second process gets a 401 for its old token and adopts the
        // rotated pair without presenting a new idempotency key.
        second.refreshAfterUnauthorized(stale);
        assertEquals(secondRefreshes, secondClient.refreshes.get(),
            "the 401 path adopts the other process's pair without a second rotation");
        assertEquals("at_rotated", second.ensureValidAccessToken());
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
