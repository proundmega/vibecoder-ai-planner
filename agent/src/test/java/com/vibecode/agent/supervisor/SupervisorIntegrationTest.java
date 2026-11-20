package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Crash-safety tests with real child processes: a supervisor is abandoned
 * without {@code close()} (equivalent to kill -9) and a new supervisor over the
 * same PID directory must adopt the exact same child set.
 */
class SupervisorIntegrationTest {

    @TempDir
    Path pidDir;

    private static RuntimeConfig config() {
        return RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 2

            [runtime "reviewers"]
            role = reviewer
            model = acme/review-model
            count = 1
            """);
    }

    @Test
    void crashRestartAdoptsTheExactChildSetAndCloseStopsThem() throws Exception {
        Assumptions.assumeTrue(sleepAvailable(), "POSIX sleep is required for this test");

        AtomicInteger launches = new AtomicInteger();
        Supervisor.ChildLauncher realLauncher = spec -> {
            launches.incrementAndGet();
            return new ProcessBuilder("sleep", "60").start();
        };
        RuntimeConfig declared = config();

        Supervisor crashed = new Supervisor(pidDir, declared, 64, realLauncher);
        Supervisor restarted = null;
        Supervisor observer = null;
        try {
            crashed.reconcile();
            assertEquals(3, launches.get());
            Set<Long> originalPids = pids(crashed.snapshot());
            assertEquals(3, originalPids.size());
            assertTrue(crashed.snapshot().stream().allMatch(Supervisor.ChildState::alive));
            assertEquals(3, pidFiles().size());
            assertTrue(Files.readString(pidDir.resolve("workers-1.pid")).contains("specHash"));

            crashed.reconcile();
            assertEquals(3, launches.get(), "reconcile must be idempotent");
            assertEquals(originalPids, pids(crashed.snapshot()));

            // Simulate kill -9: no close(), then a fresh supervisor boots over
            // the same PID directory.
            restarted = new Supervisor(pidDir, declared, 64, spec -> {
                throw new AssertionError("restart must adopt existing children, tried to spawn " + spec.name());
            });
            restarted.reconcile();

            assertEquals(originalPids, pids(restarted.snapshot()),
                "restart must adopt exactly the live children");
            assertEquals(3, restarted.snapshot().size(), "no duplicate children");
            assertEquals(3, pidFiles().size(), "no duplicate PID files");
            assertTrue(restarted.snapshot().stream().allMatch(Supervisor.ChildState::alive));
            assertTrue(allAlive(originalPids));

            // A second supervisor over the same directory converges on the same
            // child set instead of spawning siblings.
            observer = new Supervisor(pidDir, declared, 64, spec -> {
                throw new AssertionError("observer must adopt, tried to spawn " + spec.name());
            });
            observer.reconcile();
            assertEquals(originalPids, pids(observer.snapshot()));
            assertEquals(3, observer.snapshot().size());

            observer.close();
            assertTrue(allEventuallyDead(originalPids, Duration.ofSeconds(10)),
                "close must stop every child");
            assertEquals(0, pidFiles().size());
        } finally {
            if (observer != null) {
                observer.close();
            }
            if (restarted != null) {
                restarted.close();
            }
            crashed.close();
            for (long pid : pids(crashed.snapshot())) {
                ProcessHandle.of(pid).ifPresent(ProcessHandle::destroyForcibly);
            }
        }

        assertTrue(allEventuallyDead(pids(crashed.snapshot()), Duration.ofSeconds(5)));
    }

    private List<Path> pidFiles() throws IOException {
        try (Stream<Path> stream = Files.list(pidDir)) {
            return stream.filter(path -> path.getFileName().toString().endsWith(".pid"))
                .sorted()
                .toList();
        }
    }

    private static Set<Long> pids(List<Supervisor.ChildState> states) {
        return states.stream()
            .map(Supervisor.ChildState::pid)
            .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static boolean allAlive(Set<Long> pids) {
        return pids.stream().allMatch(pid -> ProcessHandle.of(pid)
            .map(ProcessHandle::isAlive)
            .orElse(false));
    }

    private static boolean allEventuallyDead(Set<Long> pids, Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            if (pids.stream().noneMatch(pid -> ProcessHandle.of(pid)
                    .map(ProcessHandle::isAlive)
                    .orElse(false))) {
                return true;
            }
            Thread.sleep(25);
        }
        return false;
    }

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
}
