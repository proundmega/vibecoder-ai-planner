package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** fg-54: one server runtime row per section, shared by that section's slots. */
class SupervisorMainTest {

    @TempDir
    Path tempDir;

    private static RuntimeConfig config() {
        return RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 3
            project = 1

            [runtime "reviewers"]
            role = reviewer
            model = acme/review
            count = 2
            """);
    }

    @Test
    void mapsOneRuntimeIdToEverySlotInTheSection() {
        Map<String, Long> ids = SupervisorMain.mapSectionRuntimeIds(config(), List.of(
            Map.of("id", 10, "name", "workers"),
            Map.of("id", 11, "name", "reviewers")));

        assertEquals(10L, ids.get("workers"));
        assertEquals(11L, ids.get("reviewers"));
    }

    @Test
    void fallsBackToDeclarationOrderWhenTheServerGeneratedNames() {
        Map<String, Long> ids = SupervisorMain.mapSectionRuntimeIds(config(), List.of(
            Map.of("id", 10, "name", "worker-model-1"),
            Map.of("id", 11, "name", "reviewer-model-2")));

        assertEquals(10L, ids.get("workers"));
        assertEquals(11L, ids.get("reviewers"));
    }

    @Test
    void refusesToGuessWhenTheSectionCountDoesNotMatch() {
        assertTrue(SupervisorMain.mapSectionRuntimeIds(config(), List.of(Map.of("id", 10))).isEmpty());
    }

    @Test
    void workerSectionsRequireAProjectForTrackAsDeclarationContract() {
        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
            IllegalArgumentException.class,
            () -> SupervisorMain.validateDeclaration(RuntimeConfig.parse("""
                [runtime "workers"]
                role = worker
                model = acme/model
                count = 1
                """)));
        assertTrue(error.getMessage().contains("requires project"));
    }

    @Test
    void declaration403IsTerminalInsteadOfRetriedForever() throws Exception {
        com.vibecode.agent.service.RuntimeApi api = mock(com.vibecode.agent.service.RuntimeApi.class);
        when(api.declareRuntimes(anyList())).thenThrow(
            new com.vibecode.agent.service.RuntimeApi.RuntimeApiException(403, "GRANT_REQUIRED"));

        org.junit.jupiter.api.Assertions.assertThrows(
            SupervisorMain.TerminalDeclarationException.class,
            () -> SupervisorMain.declareWithRetry(api, config(), 3));
    }

    @Test
    void detectsStoppedAndDrainingRuntimesAndTerminalAuthFailures() {
        java.util.Set<String> suspended = SupervisorMain.suspendedSections(Map.of(
            "runtimes", List.of(
                Map.of("name", "workers-1", "status", "stopped"),
                Map.of("name", "reviewers-1", "status", "draining"),
                Map.of("name", "planners-1", "status", "running"))),
            Map.of("workers", 1L, "reviewers", 2L, "planners", 3L));
        assertEquals(java.util.Set.of("workers", "reviewers"), suspended);
        java.util.Set<String> revokedGrant = SupervisorMain.suspendedSections(Map.of(
            "runtimes", List.of(Map.of(
                "id", 1, "name", "workers-1", "status", "running",
                "role", "worker", "current_project_id", 7)),
            "grants", List.of(Map.of("project_id", 8, "role", "worker"))),
            Map.of("workers", 1L));
        assertEquals(java.util.Set.of("workers"), revokedGrant,
            "a runtime for a revoked grant is suspended");

        java.util.Set<String> missingRuntime = SupervisorMain.suspendedSections(Map.of(
            "runtimes", List.of(),
            "grants", List.of()),
            Map.of("workers", 1L));
        assertEquals(java.util.Set.of("workers"), missingRuntime,
            "a runtime row removed from config retires its section");

        assertEquals("workers", SupervisorMain.stripRuntimeSuffix("workers-12"));

        assertTrue(SupervisorMain.terminalConfigFailure(new java.io.IOException("HTTP 401")));
        assertTrue(SupervisorMain.terminalConfigFailure(
            new com.vibecode.agent.service.AgentAuthFatalException("terminal", new java.io.IOException())));
        assertEquals(false, SupervisorMain.terminalConfigFailure(new java.io.IOException("timeout")));
    }

    @Test
    void treatsDrainingAndRevokedNodesAsInactive() {
        assertTrue(SupervisorMain.nodeActive(Map.of("node", Map.of("status", "active"))));
        assertTrue(SupervisorMain.nodeActive(Map.of()));
        assertEquals(false, SupervisorMain.nodeActive(Map.of("node", Map.of("status", "draining"))));
        assertEquals(false, SupervisorMain.nodeActive(Map.of("status", "revoked")));
    }

    @Test
    void sighupReloadReDeclaresAndSpawnsTheAddedSection() throws Exception {
        Assumptions.assumeTrue(sleepAvailable(), "POSIX sleep is required for this test");
        RuntimeConfig initial = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            project = 1
            """);
        Path ini = tempDir.resolve("agent.ini");
        Files.writeString(ini, """
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            project = 1

            [runtime "reviewers"]
            role = reviewer
            model = acme/review
            count = 1
            """);

        com.vibecode.agent.service.RuntimeApi api = mock(com.vibecode.agent.service.RuntimeApi.class);
        List<Map<String, Object>> declaredBodies = new ArrayList<>();
        when(api.declareRuntimes(anyList())).thenAnswer(invocation -> {
            List<Map<String, Object>> body = invocation.getArgument(0);
            declaredBodies.addAll(body);
            return List.of(
                Map.of("id", 1, "name", "workers"),
                Map.of("id", 2, "name", "reviewers"));
        });

        List<Long> pids = new ArrayList<>();
        Supervisor supervisor = new Supervisor(
            tempDir.resolve("pids"),
            initial,
            64,
            spec -> {
                Process process = new ProcessBuilder("sleep", "60").start();
                pids.add(process.pid());
                return process;
            },
            Map.of("workers", 1L),
            Duration.ofSeconds(2),
            Duration.ofMillis(100));
        try {
            supervisor.reconcile();
            AtomicReference<RuntimeConfig> desired = new AtomicReference<>(initial);

            RuntimeConfig applied = SupervisorMain.reload(api, supervisor, ini, desired);

            assertNotNull(applied);
            assertEquals(2, applied.runtimes().size());
            assertEquals(2, desired.get().runtimes().size());
            List<String> children = supervisor.snapshot().stream()
                .map(Supervisor.ChildState::name)
                .sorted()
                .collect(Collectors.toList());
            assertEquals(List.of("reviewers-1", "workers-1"), children);

            ArgumentCaptor<List<Map<String, Object>>> captor = ArgumentCaptor.forClass(List.class);
            org.mockito.Mockito.verify(api, org.mockito.Mockito.atLeastOnce())
                .declareRuntimes(captor.capture());
            Map<String, Object> reviewer = captor.getValue().stream()
                .filter(row -> "reviewers".equals(row.get("name")))
                .findFirst()
                .orElseThrow();
            assertEquals("reviewer", reviewer.get("role"));
            assertEquals(1, reviewer.get("concurrency"));
            assertEquals("acme/review", reviewer.get("modelRef"));
        } finally {
            supervisor.close();
            for (long pid : pids) {
                ProcessHandle.of(pid).ifPresent(ProcessHandle::destroy);
            }
        }
    }

    private static boolean sleepAvailable() {
        try {
            Process process = new ProcessBuilder("sleep", "0").start();
            return process.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }
}
