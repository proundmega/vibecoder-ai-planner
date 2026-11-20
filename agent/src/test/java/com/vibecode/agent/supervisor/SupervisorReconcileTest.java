package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SupervisorReconcileTest {

    @TempDir
    Path pidDir;

    private static RuntimeConfig workers(int count) {
        return RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = %d
            """.formatted(count));
    }

    private static List<Path> pidFiles(Path dir) throws IOException {
        try (Stream<Path> stream = Files.list(dir)) {
            return stream.filter(path -> path.getFileName().toString().endsWith(".pid"))
                .sorted()
                .toList();
        }
    }

    @Test
    void applyTwiceIsANoOp() throws IOException {
        FakeLauncher launcher = new FakeLauncher();
        Supervisor supervisor = new Supervisor(pidDir, workers(2), 256, launcher);
        try {
            supervisor.reconcile();
            assertEquals(2, launcher.launchCount.get());
            assertEquals(0, launcher.destroyCount.get());
            List<Supervisor.ChildState> first = supervisor.snapshot();

            supervisor.reconcile();

            assertEquals(2, launcher.launchCount.get(), "second reconcile must not spawn");
            assertEquals(0, launcher.destroyCount.get(), "second reconcile must not destroy");
            assertEquals(first, supervisor.snapshot());
            assertEquals(2, pidFiles(pidDir).size());
            assertTrue(supervisor.snapshot().stream().allMatch(Supervisor.ChildState::alive));
        } finally {
            supervisor.close();
        }
        assertEquals(2, launcher.destroyCount.get(), "close stops every managed child");
        assertEquals(0, pidFiles(pidDir).size());
    }

    @Test
    void removingOneEntryDrainsOnlyThatChild() throws IOException {
        RuntimeConfig both = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 2

            [runtime "reviewers"]
            role = reviewer
            model = acme/review-model
            count = 1
            """);
        FakeLauncher launcher = new FakeLauncher();
        Supervisor supervisor = new Supervisor(pidDir, both, 256, launcher);
        try {
            supervisor.reconcile();
            assertEquals(3, launcher.launchCount.get());
            FakeProcess worker1 = launcher.byName.get("workers-1");
            FakeProcess worker2 = launcher.byName.get("workers-2");
            FakeProcess reviewer = launcher.byName.get("reviewers-1");
            assertTrue(worker1.isAlive() && worker2.isAlive() && reviewer.isAlive());
            assertTrue(Files.exists(pidDir.resolve("reviewers-1.pid")));

            supervisor.reconcile(workers(2));

            assertFalse(reviewer.isAlive(), "the removed child must be drained");
            assertTrue(worker1.isAlive(), "unchanged children must not be touched");
            assertTrue(worker2.isAlive(), "unchanged children must not be touched");
            assertEquals(1, launcher.destroyCount.get());
            assertEquals(3, launcher.launchCount.get(), "removal must not respawn survivors");
            assertEquals(2, supervisor.snapshot().size());
            assertFalse(Files.exists(pidDir.resolve("reviewers-1.pid")));
            assertTrue(Files.exists(pidDir.resolve("workers-1.pid")));

            supervisor.reconcile(workers(2));
            assertEquals(1, launcher.destroyCount.get());
            assertEquals(3, launcher.launchCount.get());
        } finally {
            supervisor.close();
        }
    }

    @Test
    void specChangeReplacesOnlyTheAffectedChild() throws IOException {
        RuntimeConfig high = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            effort = high

            [runtime "reviewers"]
            role = reviewer
            model = acme/review-model
            count = 1
            """);
        RuntimeConfig low = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            effort = low

            [runtime "reviewers"]
            role = reviewer
            model = acme/review-model
            count = 1
            """);
        FakeLauncher launcher = new FakeLauncher();
        Supervisor supervisor = new Supervisor(pidDir, high, 256, launcher);
        try {
            supervisor.reconcile();
            FakeProcess oldWorker = launcher.byName.get("workers-1");
            FakeProcess reviewer = launcher.byName.get("reviewers-1");
            long oldPid = oldWorker.pid();

            supervisor.reconcile(low);

            assertFalse(oldWorker.isAlive(), "the changed child must be replaced");
            assertTrue(reviewer.isAlive(), "the unchanged child must not be touched");
            FakeProcess newWorker = launcher.byName.get("workers-1");
            assertNotEquals(oldPid, newWorker.pid());
            assertTrue(newWorker.isAlive());
            assertEquals(3, launcher.launchCount.get());
            assertEquals(1, launcher.destroyCount.get());
            assertEquals(RuntimeConfig.Effort.LOW, supervisor.snapshot().stream()
                .filter(state -> state.name().equals("workers-1"))
                .map(state -> RuntimeConfig.Effort.fromWire(state.effort()))
                .findFirst()
                .orElseThrow());

            supervisor.reconcile();
            assertEquals(3, launcher.launchCount.get());
            assertEquals(1, launcher.destroyCount.get());
        } finally {
            supervisor.close();
        }
    }

    @Test
    void startupSweepAdoptsMatchingOrphanAndStopsAlienOrphan() throws Exception {
        Assumptions.assumeTrue(sleepAvailable(), "POSIX sleep is required for adoption tests");
        Process adopted = startSleep();
        Process alien = startSleep();
        try {
            RuntimeConfig config = workers(1);
            String specHash = config.expandedSlots().get(0).specHash();
            writePidFile(pidDir, "workers-1", adopted.pid(), specHash);
            writePidFile(pidDir, "reviewers-9", alien.pid(), "alien-spec");

            FakeLauncher launcher = new FakeLauncher();
            Supervisor supervisor = new Supervisor(pidDir, config, 256, launcher);
            try {
                assertEquals(0, launcher.launchCount.get(), "adoption must not spawn a duplicate");
                List<Supervisor.ChildState> states = supervisor.snapshot();
                assertEquals(1, states.size());
                assertEquals("workers-1", states.get(0).name());
                assertEquals(adopted.pid(), states.get(0).pid());
                assertEquals(specHash, states.get(0).specHash());
                assertTrue(adopted.isAlive(), "the adopted child must stay alive");
                assertFalse(alien.isAlive(), "an unmanaged live child must be stopped");
                assertFalse(Files.exists(pidDir.resolve("reviewers-9.pid")));
                assertTrue(Files.exists(pidDir.resolve("workers-1.pid")));
            } finally {
                supervisor.close();
            }
            assertTrue(adopted.waitFor(5, TimeUnit.SECONDS), "close must stop an adopted child");
            assertFalse(adopted.isAlive());
        } finally {
            adopted.destroyForcibly();
            alien.destroyForcibly();
        }
    }

    @Test
    void startupSweepDeletesDeadPidFiles() throws IOException {
        writePidFile(pidDir, "workers-1", 999_999_999L, "dead-spec");

        FakeLauncher launcher = new FakeLauncher();
        try (Supervisor supervisor = new Supervisor(pidDir, workers(1), 256, launcher)) {
            assertEquals(0, launcher.launchCount.get());
            assertTrue(supervisor.snapshot().isEmpty());
        }
        assertEquals(0, pidFiles(pidDir).size());
    }

    @Test
    void spawnSpecCarriesRoleModelAndRuntimeIdWithoutSecrets() throws IOException {
        FakeLauncher launcher = new FakeLauncher();
        RuntimeConfig config = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 1
            effort = max
            project = 17
            """);
        try (Supervisor supervisor = new Supervisor(
                pidDir, config, 512, launcher,
                Map.of("workers-1", 77L), Duration.ofSeconds(2), Duration.ofSeconds(1))) {
            supervisor.reconcile();

            Supervisor.SpawnSpec spec = launcher.specs.get(0);
            assertEquals("workers-1", spec.name());
            assertEquals(RuntimeConfig.Role.WORKER, spec.role());
            assertEquals("acme/model", spec.modelRef());
            assertEquals(RuntimeConfig.Effort.MAX, spec.effort());
            assertEquals("17", spec.project());
            assertEquals(77L, spec.runtimeId());
            assertEquals(512, spec.heapMb());
            assertEquals("workers", spec.environment().get("AGENT_RUNTIME_NAME"));
            assertEquals("worker", spec.environment().get("AGENT_ROLE"));
            assertEquals("acme/model", spec.environment().get("AGENT_LLM_MODEL"));
            assertEquals("max", spec.environment().get("AGENT_EFFORT"));
            assertEquals("17", spec.environment().get("AGENT_PROJECT_ID"));
            assertEquals("77", spec.environment().get("AGENT_RUNTIME_ID"));
            for (String key : spec.environment().keySet()) {
                String upper = key.toUpperCase();
                assertFalse(upper.contains("SECRET") || upper.contains("TOKEN")
                    || upper.contains("PASSWORD"), "unexpected credential env key " + key);
            }
        }

        List<String> command = Supervisor.buildCommand(512);
        assertTrue(command.contains("-Xmx512m"));
        assertTrue(command.stream().noneMatch(arg -> arg.toLowerCase().contains("api_key")));
    }

    @Test
    void reconcilesFiftyRuntimesUnderThirtySeconds() throws IOException {
        StringBuilder ini = new StringBuilder();
        for (int i = 1; i <= 50; i++) {
            ini.append("[runtime \"w").append(i).append("\"]\n")
                .append("role = worker\n")
                .append("model = acme/model\n")
                .append("count = 1\n\n");
        }
        RuntimeConfig config = RuntimeConfig.parse(ini.toString());
        FakeLauncher launcher = new FakeLauncher();
        long started = System.nanoTime();
        Supervisor supervisor = new Supervisor(pidDir, config, 128, launcher);
        try {
            supervisor.reconcile();
            long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
            assertEquals(50, supervisor.snapshot().size());
            assertEquals(50, launcher.launchCount.get());
            assertTrue(elapsedMs < 30_000, "50 runtimes took " + elapsedMs + " ms");
            supervisor.reconcile();
            assertEquals(50, launcher.launchCount.get());
            assertTrue(elapsedMs < 30_000);
        } finally {
            supervisor.close();
        }
        assertEquals(50, launcher.destroyCount.get());
    }

    @Test
    void closedSupervisorRejectsReconcile() {
        RuntimeConfig empty = RuntimeConfig.parse("");
        Supervisor supervisor = new Supervisor(pidDir, empty, 128, new FakeLauncher());
        supervisor.close();
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, supervisor::reconcile);
    }

    // ------------------------------------------------------------------
    // helpers / fakes
    // ------------------------------------------------------------------

    private static boolean sleepAvailable() {
        Path sleep = Path.of("/bin/sleep");
        if (!Files.isExecutable(sleep)) {
            sleep = Path.of("/usr/bin/sleep");
        }
        if (!Files.isExecutable(sleep)) {
            return false;
        }
        try {
            Process process = new ProcessBuilder("sleep", "0.05").start();
            return process.waitFor(2, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private static Process startSleep() throws IOException {
        return new ProcessBuilder("sleep", "60").start();
    }

    private static void writePidFile(Path dir, String name, long pid, String specHash)
            throws IOException {
        String startedAt = ProcessHandle.of(pid)
            .flatMap(handle -> handle.info().startInstant())
            .orElse(Instant.now())
            .toString();
        String json = "{\"pid\":" + pid + ",\"name\":\"" + name
            + "\",\"specHash\":\"" + specHash + "\",\"startedAt\":\"" + startedAt + "\"}";
        Files.writeString(dir.resolve(name + ".pid"), json);
    }

    private static final class FakeProcess extends Process {
        private final long pid;
        private final AtomicBoolean alive = new AtomicBoolean(true);
        private final AtomicInteger destroyCount;

        private FakeProcess(long pid, AtomicInteger destroyCount) {
            this.pid = pid;
            this.destroyCount = destroyCount;
        }

        @Override
        public OutputStream getOutputStream() {
            return OutputStream.nullOutputStream();
        }

        @Override
        public InputStream getInputStream() {
            return InputStream.nullInputStream();
        }

        @Override
        public InputStream getErrorStream() {
            return InputStream.nullInputStream();
        }

        @Override
        public int waitFor() {
            return 0;
        }

        @Override
        public boolean waitFor(long timeout, TimeUnit unit) {
            return !alive.get();
        }

        @Override
        public int exitValue() {
            if (alive.get()) {
                throw new IllegalThreadStateException("still running");
            }
            return 0;
        }

        @Override
        public void destroy() {
            if (alive.compareAndSet(true, false)) {
                destroyCount.incrementAndGet();
            }
        }

        @Override
        public Process destroyForcibly() {
            destroy();
            return this;
        }

        @Override
        public boolean isAlive() {
            return alive.get();
        }

        @Override
        public long pid() {
            return pid;
        }

        @Override
        public ProcessHandle toHandle() {
            throw new UnsupportedOperationException();
        }
    }

    private static final class FakeLauncher implements Supervisor.ChildLauncher {
        private final List<Supervisor.SpawnSpec> specs = new ArrayList<>();
        private final Map<String, FakeProcess> byName = new LinkedHashMap<>();
        private final AtomicInteger launchCount = new AtomicInteger();
        private final AtomicInteger destroyCount = new AtomicInteger();
        private long nextPid = 10_000;

        @Override
        public Process launch(Supervisor.SpawnSpec spec) {
            specs.add(spec);
            launchCount.incrementAndGet();
            FakeProcess process = new FakeProcess(nextPid++, destroyCount);
            byName.put(spec.name(), process);
            return process;
        }
    }
}
