package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.TicketWorker;
import com.vibecode.agent.harness.ProviderSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * fg-54: provider rotation and the revocation path that releases the current
 * claim and writes the supervisor stop marker.
 */
class AgentAppRuntimeLifecycleTest {

    static class ModeConfig extends AgentConfig {
        String stopFile;

        @Override public boolean isReviewMode() { return true; }
        @Override public String getRuntimeStopFile() { return stopFile; }
    }

    static class StubApi extends ApiService {
        volatile Map<String, Object> providerConfig;
        volatile boolean failHeartbeats;
        final List<String> heartbeatStatuses = new ArrayList<>();
        Long releasedTicket;

        StubApi(AgentConfig config) {
            super(config);
        }

        @Override
        public Map<String, Object> getProviderConfig() {
            return providerConfig;
        }

        @Override
        public Map<String, Object> requestGitHubToken(String projectId, boolean forceRefresh) {
            return Map.of("token", "ghs_runtime_lifecycle", "mode", "app");
        }

        @Override
        public void sendHeartbeat(String runtimeId, String status, Object currentProjectId)
                throws IOException {
            if (failHeartbeats) {
                throw new IOException("heartbeat unavailable");
            }
            heartbeatStatuses.add(status);
        }

        @Override
        public Ticket releaseTicket(Long ticketId) {
            releasedTicket = ticketId;
            return null;
        }
    }

    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void resetRefreshClock(AgentApp app) throws Exception {
        setField(app, "lastProviderRefreshAt", 0L);
    }

    private static Map<String, Object> provider(String key, String model) {
        return Map.of("providerType", "claude", "apiKey", key, "model", model);
    }

    @Test
    void rotatesTheProviderBetweenTicketsWithoutARestart() throws Exception {
        ModeConfig config = new ModeConfig();
        config.setRuntimeId("7");
        StubApi api = new StubApi(config);
        api.providerConfig = provider("key-a", "model-a");

        AgentApp app = new AgentApp(config, null, api);
        assertEquals("key-a", ((ProviderSettings) field(app, "providerSettings")).apiKey());

        api.providerConfig = provider("key-b", "model-b");
        resetRefreshClock(app);
        app.refreshProviderSettingsIfDue();

        ProviderSettings rotated = (ProviderSettings) field(app, "providerSettings");
        assertEquals("key-b", rotated.apiKey());
        assertEquals("model-b", rotated.model());

        // An unchanged config must not rebuild the wiring on every poll.
        TicketWorker worker = (TicketWorker) field(app, "ticketWorker");
        resetRefreshClock(app);
        app.refreshProviderSettingsIfDue();
        assertTrue(worker == field(app, "ticketWorker"),
            "an unchanged provider config should keep the existing wiring");
    }

    @Test
    void aFailedProviderRefreshKeepsTheWorkingProvider() throws Exception {
        ModeConfig config = new ModeConfig();
        config.setRuntimeId("8");
        StubApi api = new StubApi(config);
        api.providerConfig = provider("key-a", "model-a");

        AgentApp app = new AgentApp(config, null, api);
        api.providerConfig = null;
        resetRefreshClock(app);
        app.refreshProviderSettingsIfDue();

        assertEquals("key-a", ((ProviderSettings) field(app, "providerSettings")).apiKey(),
            "a failed config read must not replace a working provider");
    }

    @Test
    void firstHeartbeatIsRetriedUntilItReportsRunning() throws Exception {
        ModeConfig config = new ModeConfig();
        config.setRuntimeId("9");
        StubApi api = new StubApi(config);
        AgentApp app = new AgentApp(config, null, api);

        api.failHeartbeats = true;
        app.heartbeatTick();
        assertTrue(api.heartbeatStatuses.isEmpty());

        api.failHeartbeats = false;
        app.heartbeatTick();
        app.heartbeatTick();

        assertEquals(java.util.Arrays.asList("running", null), api.heartbeatStatuses,
            "running is reported once; later heartbeats preserve admin drain/stop");
    }

    @Test
    void revocationReleasesTheClaimAndWritesTheStopMarker(@TempDir Path tempDir) throws Exception {
        ModeConfig config = new ModeConfig();
        config.setRuntimeId("10");
        config.stopFile = tempDir.resolve("runtime.stop").toString();
        StubApi api = new StubApi(config);
        AgentApp app = new AgentApp(config, null, api);

        TicketWorker worker = mock(TicketWorker.class);
        when(worker.getCurrentTicketId()).thenReturn("42");
        setField(app, "ticketWorker", worker);

        Method release = AgentApp.class.getDeclaredMethod("releaseCurrentClaim");
        release.setAccessible(true);
        release.invoke(app);

        Method marker = AgentApp.class.getDeclaredMethod("writeStopMarker");
        marker.setAccessible(true);
        marker.invoke(app);

        assertEquals(42L, api.releasedTicket);
        assertEquals("revoked", Files.readString(Path.of(config.stopFile)));
    }

    @Test
    void releaseIsSkippedWhenNoTicketIsClaimed() throws Exception {
        ModeConfig config = new ModeConfig();
        StubApi api = new StubApi(config);
        AgentApp app = new AgentApp(config, null, api);

        Method release = AgentApp.class.getDeclaredMethod("releaseCurrentClaim");
        release.setAccessible(true);
        release.invoke(app);

        assertNull(api.releasedTicket);
    }
}
