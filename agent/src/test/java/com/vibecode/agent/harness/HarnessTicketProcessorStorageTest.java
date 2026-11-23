package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubService;
import com.vibecode.agent.service.WorkspaceManager;
import com.vibecode.agent.supervisor.StoragePolicy;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** fg-44/fg-58: cleanup, quarantine, budget meter and the storage thresholds. */
class HarnessTicketProcessorStorageTest {

    @TempDir
    Path tempDir;

    @Test
    void terminalCleanupDeletesTheTicketWorkspaceAndMarker() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getWorkspaceRoot().resolve("repo"));
        manager.writeActiveMarker("run-1");
        assertTrue(Files.exists(manager.getWorkspaceRoot().resolve(".active")));

        manager.cleanup("34");

        assertFalse(Files.exists(manager.getWorkspaceRoot()));
        assertTrue(Files.exists(runtimeRoot));
    }

    @Test
    void roleBudgetAndOverrideDriveTheBreachThreshold() {
        assertEquals(20, StoragePolicy.budgetGbFor("worker", null));
        assertEquals(10, StoragePolicy.budgetGbFor("reviewer", null));
        assertEquals(5, StoragePolicy.budgetGbFor("light", null));
        assertEquals(3, StoragePolicy.budgetGbFor("worker", "3"));
    }

    @Test
    void budgetThresholdIsInclusiveAtTheLimitAndAbove() {
        long gb = 1024L * 1024L * 1024L;
        assertFalse(HarnessTicketProcessor.storageBudgetExceeded(20 * gb, 20));
        assertTrue(HarnessTicketProcessor.storageBudgetExceeded(20 * gb + 1, 20));
        assertFalse(HarnessTicketProcessor.storageBudgetExceeded(100 * gb, 0));
    }

    @Test
    void periodicMeterEmitsBudgetEventAndMarksTheRun() throws Exception {
        AgentConfig config = mock(AgentConfig.class);
        when(config.getRole()).thenReturn("worker");
        when(config.getRuntimeId()).thenReturn("12");
        ApiService apiService = mock(ApiService.class);

        WorkspaceManager workspace = mock(WorkspaceManager.class);
        when(workspace.runtimeBytes()).thenReturn(21L * 1024L * 1024L * 1024L);

        HarnessTicketProcessor processor = processor(apiService, workspace);

        set(processor, "activeStorageWorkspace", workspace);
        set(processor, "activeStorageTicketId", 7L);
        set(processor, "eventContext", new HarnessEventContext(
            UUID.randomUUID(), UUID.randomUUID(), 7L, 1L, 12L, null));

        processor.checkStorageMeter();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(apiService).emitHarnessEvent(body.capture());
        assertEquals("storage.budget_exceeded", body.getValue().get("type"));
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) body.getValue().get("payload");
        assertEquals(21.0, ((Number) payload.get("usedGb")).doubleValue(), 0.01);
        assertTrue((Boolean) get(processor, "storageBudgetBreached"));
    }

    @Test
    void budgetBreachQuarantinesThroughTheProcessor() throws Exception {
        Path repoBase = tempDir.resolve("repos");
        WorkspaceManager manager = new WorkspaceManager(
            repoBase.resolve("runtimes/12").toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getWorkspaceRoot().resolve("repo"));
        Files.writeString(manager.getWorkspaceRoot().resolve("repo/file.txt"), "x");
        Files.createDirectories(manager.getCacheDir());
        Files.writeString(manager.getCacheDir().resolve("cache.bin"), "x");

        HarnessTicketProcessor processor = processor(mock(ApiService.class), manager);
        set(processor, "storageBudgetBreached", true);

        processor.cleanupWorkspaceAfterRun(manager, 34L);

        assertFalse(Files.exists(manager.getWorkspaceRoot()), "the breach does not delete");
        assertFalse(Files.exists(manager.getCacheDir()), "single-runtime cache is cleared");
        Path orphans = repoBase.resolve("orphans");
        assertTrue(Files.isDirectory(orphans), "quarantine goes to /repos/orphans");
        try (var entries = Files.list(orphans)) {
            assertTrue(entries.findAny().isPresent(), "quarantined ticket root exists");
        }
    }

    @Test
    void runtimeMarkerExistsDuringProfileFetchAndClearsAfterwards() throws Exception {
        Path runtimeRoot = tempDir.resolve("repos/runtimes/12");
        Ticket ticket = new Ticket();
        ticket.setId(1L);
        ticket.setTitle("Add filtering");
        ticket.setStatus("in_progress");
        ApiService apiService = mock(ApiService.class);
        when(apiService.pickUpTicket(1L)).thenReturn(ticket);
        when(apiService.postMessage(any(), anyString(), anyString()))
            .thenReturn(new TicketMessage());
        when(apiService.releaseTicket(1L)).thenReturn(ticket);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        RepoProfileSource source = () -> {
            entered.countDown();
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalArgumentException("stop after the latch");
        };
        HarnessTicketProcessor processor = processor(
            apiService, mock(WorkspaceManager.class), runtimeRoot.toString(), source);

        Thread thread = new Thread(() -> processor.processTicket(ticket));
        thread.start();
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS), "profile fetch reached");
            assertTrue(Files.exists(runtimeRoot.resolve(".active")),
                "marker is written before profile fetch");
        } finally {
            release.countDown();
            thread.join(5000);
        }

        assertFalse(thread.isAlive(), "run exits after the profile failure");
        assertFalse(Files.exists(runtimeRoot.resolve(".active")),
            "marker is cleared on every exit");
    }

    @Test
    void runtimeActiveMarkerCoversThePickupToTicketMarkerWindow() throws Exception {
        Path runtimeRoot = tempDir.resolve("repos/runtimes/12");
        HarnessTicketProcessor processor = processor(
            mock(ApiService.class), mock(WorkspaceManager.class), runtimeRoot.toString());

        processor.writeRuntimeActiveMarker(7L);

        Path marker = runtimeRoot.resolve(".active");
        assertTrue(Files.exists(marker), "runtime marker written at pickup");
        assertEquals("7", Files.readString(marker));

        processor.clearRuntimeActiveMarker();

        assertFalse(Files.exists(marker), "runtime marker cleared at the end");
    }

    @Test
    void legacyRepoRootDoesNotGetARuntimeMarker() {
        HarnessTicketProcessor processor = processor(
            mock(ApiService.class), mock(WorkspaceManager.class),
            tempDir.resolve("repos").toString());

        assertNull(processor.runtimeActiveMarkerPath());
    }

    @Test
    void sharedRuntimeDoesNotWriteASingleRootMarker() {
        HarnessTicketProcessor processor = processor(
            mock(ApiService.class), mock(WorkspaceManager.class),
            tempDir.resolve("repos/runtimes/12").toString(), null, 2);

        assertNull(processor.runtimeActiveMarkerPath());
    }

    private HarnessTicketProcessor processor(
        ApiService apiService,
        WorkspaceManager workspace
    ) {
        return processor(apiService, workspace, null);
    }

    private HarnessTicketProcessor processor(
        ApiService apiService,
        WorkspaceManager workspace,
        String repoCloneDir
    ) {
        return processor(apiService, workspace, repoCloneDir, null, 1);
    }

    private HarnessTicketProcessor processor(
        ApiService apiService,
        WorkspaceManager workspace,
        String repoCloneDir,
        RepoProfileSource source
    ) {
        return processor(apiService, workspace, repoCloneDir, source, 1);
    }

    private HarnessTicketProcessor processor(
        ApiService apiService,
        WorkspaceManager workspace,
        String repoCloneDir,
        RepoProfileSource source,
        int concurrency
    ) {
        AgentConfig config = mock(AgentConfig.class);
        when(config.getRole()).thenReturn("worker");
        when(config.getRuntimeId()).thenReturn("12");
        when(config.getRuntimeConcurrency()).thenReturn(concurrency);
        when(config.isDryRun()).thenReturn(false);
        when(config.getGitHubBranchName(anyLong(), anyString())).thenReturn("branch");
        if (repoCloneDir != null) {
            when(config.getRepoCloneDir()).thenReturn(repoCloneDir);
        }
        return new HarnessTicketProcessor(
            config, apiService,
            new ProviderSettings("opencode-go", "secret", null, "beam-free", 4096),
            mock(GitHubService.class), "token",
            new HarnessConfig("opencode", java.time.Duration.ofSeconds(30),
                java.time.Duration.ofMinutes(45), List.of("npm test"),
                List.of(".env*"), null, "restart"),
            repoName -> workspace,
            (ignored, bridge, effectiveConfig) -> mock(HarnessClient.class),
            mock(PlanningDocFetcher.class),
            source == null ? () -> null : source,
            mock(VerificationRunner.class),
            new PublishingGuard(List.of(".env*")),
            SandboxConfig.defaults(),
            SandboxRunnerFactory.hostOnly());
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = HarnessTicketProcessor.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    private static Object get(Object target, String field) throws Exception {
        Field f = HarnessTicketProcessor.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(target);
    }
}
