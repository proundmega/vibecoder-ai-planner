package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Starts child processes in their own process group and kills the whole group
 * afterwards.
 *
 * <p>Killing only {@link Process#destroy()} is insufficient: a harness or test
 * can spawn {@code sleep 1000 &} and exit, leaving a process that later edits
 * the workspace or reads supervisor state. On POSIX, {@code setsid} makes the
 * child a group leader so {@code kill -KILL -<pid>} reaches every descendant.</p>
 */
public final class ProcessGroup {

    private static final boolean WINDOWS = System.getProperty("os.name", "")
        .toLowerCase(Locale.ROOT).contains("win");
    private static final Path SETSID = findSetsid();

    private ProcessGroup() {
    }

    static boolean isGroupIsolationAvailable() {
        return !WINDOWS && SETSID != null;
    }

    /**
     * Wrap a command so it becomes its own process-group leader. Returns the
     * original command unchanged when isolation is unavailable.
     */
    public static List<String> wrap(List<String> command) {
        if (WINDOWS || SETSID == null || command == null || command.isEmpty()) {
            return command;
        }
        List<String> wrapped = new ArrayList<>(command.size() + 1);
        wrapped.add(SETSID.toString());
        wrapped.addAll(command);
        return wrapped;
    }

    /**
     * Kill the process and every process in its group. Safe to call after the
     * leader has exited.
     */
    public static void kill(Process process) {
        if (process == null) {
            return;
        }
        try {
            process.descendants().forEach(handle -> {
                try {
                    handle.destroyForcibly();
                } catch (RuntimeException ignored) {
                    // Already exited.
                }
            });
        } catch (RuntimeException ignored) {
            // Descendant enumeration is best effort.
        }

        if (WINDOWS) {
            runQuietly(List.of("taskkill", "/T", "/F", "/PID", String.valueOf(process.pid())));
        } else if (SETSID != null) {
            // BusyBox kill accepts `-KILL -<pgid>` but not the `--` separator.
            runQuietly(List.of("kill", "-KILL", "-" + process.pid()));
        }

        process.destroyForcibly();
        try {
            process.waitFor(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void runQuietly(List<String> command) {
        try {
            Process killer = new ProcessBuilder(command)
                .redirectErrorStream(true)
                .start();
            killer.waitFor(2, TimeUnit.SECONDS);
        } catch (IOException | InterruptedException ignored) {
            if (ignored instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private static Path findSetsid() {
        if (WINDOWS) {
            return null;
        }
        List<Path> candidates = new ArrayList<>();
        candidates.add(Path.of("/usr/bin/setsid"));
        candidates.add(Path.of("/bin/setsid"));
        String path = System.getenv("PATH");
        if (path != null) {
            for (String entry : path.split(":")) {
                if (!entry.isBlank()) {
                    candidates.add(Path.of(entry, "setsid"));
                }
            }
        }
        for (Path candidate : candidates) {
            if (Files.isExecutable(candidate)) {
                return candidate;
            }
        }
        return null;
    }
}
