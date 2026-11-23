package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-44: watermarks, idle/max lifetime, runtime-root/legacy sweep. */
class SupervisorStorageTest {

    @TempDir
    Path pidDir;

    private static StoragePolicy.RuntimeState state(boolean idle, Instant startedAt) {
        return new StoragePolicy.RuntimeState(
            "worker", 20, false, false, false, false,
            Instant.now().minus(Duration.ofHours(3)),
            startedAt == null ? Instant.now() : startedAt);
    }

    @Test
    void parsesDefaultsAndWatermarks() {
        StoragePolicy policy = StoragePolicy.fromEnv(Map.of());
        assertEquals(Duration.ofHours(2).toMillis(), policy.idleRefreshMs());
        assertEquals(24, policy.maxLifetimeHours());
        assertEquals(StoragePolicy.StorageAction.WARN, policy.evaluate(
            new StoragePolicy.Usage(70, 0), state(false, Instant.now())));
        assertEquals(StoragePolicy.StorageAction.STOP_SPAWN, policy.evaluate(
            new StoragePolicy.Usage(80, 0), state(false, Instant.now())));
        assertEquals(StoragePolicy.StorageAction.CLEAN_IDLE, policy.evaluate(
            new StoragePolicy.Usage(85, 0), state(true, Instant.now())));
        assertEquals(StoragePolicy.StorageAction.RECYCLE_OLDEST, policy.evaluate(
            new StoragePolicy.Usage(90, 0), state(true, Instant.now())));
        assertEquals(StoragePolicy.StorageAction.MANUAL_RECOVERY, policy.evaluate(
            new StoragePolicy.Usage(95, 0), state(true, Instant.now())));
    }

    @Test
    void inodesUseTheSameThresholds() {
        StoragePolicy policy = StoragePolicy.fromEnv(Map.of());
        assertEquals(StoragePolicy.StorageAction.STOP_SPAWN, policy.evaluate(
            new StoragePolicy.Usage(10, 80), state(false, Instant.now())));
        assertEquals(StoragePolicy.StorageAction.MANUAL_RECOVERY, policy.evaluate(
            new StoragePolicy.Usage(10, 95), state(false, Instant.now())));
    }

    @Test
    void idleAndLifetimeOnlyApplyToIdleRuntimes() {
        StoragePolicy policy = StoragePolicy.fromEnv(Map.of());
        StoragePolicy.RuntimeState oldIdle = state(true, Instant.now().minus(Duration.ofHours(25)));
        StoragePolicy.RuntimeState oldBusy = new StoragePolicy.RuntimeState(
            "worker", 20, true, true, true, true,
            Instant.now().minus(Duration.ofHours(3)), Instant.now().minus(Duration.ofHours(25)));

        assertTrue(policy.lifetimeExpired(oldIdle));
        assertFalse(policy.lifetimeExpired(oldBusy));
        assertEquals(StoragePolicy.StorageAction.CLEAN_IDLE, policy.evaluate(
            new StoragePolicy.Usage(10, 10), oldIdle));

        Instant now = Instant.now();
        assertTrue(StoragePolicy.refreshDue(false, now.minus(Duration.ofHours(25)),
            now.minus(Duration.ofMinutes(1)), now, Duration.ofHours(2).toMillis(), 24));
        assertTrue(StoragePolicy.refreshDue(false, now,
            now.minus(Duration.ofHours(3)), now, Duration.ofHours(2).toMillis(), 24));
        assertFalse(StoragePolicy.refreshDue(true, now.minus(Duration.ofHours(25)),
            now.minus(Duration.ofHours(3)), now, Duration.ofHours(2).toMillis(), 24));
    }

    @Test
    void idleRuntimeIsStoppedAndItsRootRemoved() throws Exception {
        Path repoBase = pidDir.resolve("repos");
        RuntimeConfig config = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            project = 1
            """);
        AtomicInteger spawns = new AtomicInteger();
        java.util.List<String> events = new java.util.ArrayList<>();
        Supervisor supervisor = new Supervisor(
            pidDir, config, 64,
            spec -> {
                spawns.incrementAndGet();
                return new ProcessBuilder("sleep", "60").start();
            },
            Map.of("workers", 12L),
            Duration.ofSeconds(2),
            Duration.ofMillis(50));
        supervisor.setRepoBase(repoBase);
        supervisor.setStoragePolicy(new StoragePolicy(
            1000L, 24, 70, 80, 85, 90, 95, 24, 24));
        supervisor.setStorageEventSink((type, payload) -> events.add(type));
        try {
            supervisor.reconcile();
            assertEquals(1, spawns.get());

            Path runtimeRoot = Files.createDirectories(repoBase.resolve("runtimes/12"));
            Files.setLastModifiedTime(runtimeRoot,
                FileTime.from(Instant.now().minus(Duration.ofHours(3))));

            supervisor.reconcile();

            assertTrue(events.contains("storage.refresh"), events.toString());
            assertFalse(Files.exists(runtimeRoot), "idle runtime root removed");
            assertEquals(2, spawns.get(), "the runtime is respawned");
        } finally {
            supervisor.close();
        }
    }

    @Test
    void roleBudgetsAndOverrideAreApplied() {
        assertEquals(20, StoragePolicy.budgetGbFor("worker", null));
        assertEquals(10, StoragePolicy.budgetGbFor("reviewer", null));
        assertEquals(5, StoragePolicy.budgetGbFor("light", null));
        assertEquals(7, StoragePolicy.budgetGbFor("worker", "7"));
    }

    @Test
    void supervisorPassesTheRuntimeScopedCloneRoot() throws Exception {
        RuntimeConfig config = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            project = 1
            """);
        AtomicReference<Supervisor.SpawnSpec> spawned = new AtomicReference<>();
        java.util.List<String> events = new java.util.ArrayList<>();
        Supervisor supervisor = new Supervisor(
            pidDir, config, 64,
            spec -> {
                spawned.set(spec);
                return new ProcessBuilder("sleep", "60").start();
            },
            Map.of("workers", 12L),
            Duration.ofSeconds(2),
            Duration.ofMillis(50));
        supervisor.setStorageEventSink((type, payload) -> events.add(type));
        try {
            supervisor.reconcile();
            assertEquals("/repos/runtimes/12", spawned.get().environment().get("REPO_CLONE_DIR"));
            assertTrue(events.contains("storage.workspace"));
        } finally {
            supervisor.close();
        }
    }

    @Test
    void samplesDiskAndInodePercentages() {
        StorageUsage usage = StorageUsage.sample(pidDir);
        assertTrue(usage.diskPct() >= 0 && usage.diskPct() <= 100);
        assertTrue(usage.inodePct() >= 0 && usage.inodePct() <= 100);
    }

    @Test
    void storageActionUsesTheLatestUsageSample() {
        Supervisor supervisor = new Supervisor(
            pidDir, RuntimeConfig.parse("""
                [runtime "workers"]
                role = worker
                model = acme/model
                count = 1
                project = 1
                """), 64,
            spec -> new ProcessBuilder("sleep", "60").start(),
            Map.of("workers", 12L),
            Duration.ofSeconds(1),
            Duration.ofSeconds(1));
        try {
            supervisor.setStorageUsage(new StoragePolicy.Usage(96, 0));
            assertEquals(StoragePolicy.StorageAction.MANUAL_RECOVERY,
                supervisor.storageAction(state(true, Instant.now())));
        } finally {
            supervisor.close();
        }
    }
}
