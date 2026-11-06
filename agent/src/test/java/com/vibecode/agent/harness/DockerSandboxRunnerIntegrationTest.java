package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end smoke test for the Docker sandbox.
 *
 * <p>Opt-in: set {@code SANDBOX_IT_IMAGE} to a small image that has
 * {@code /bin/sh} (for example {@code redis:7-alpine}). CI enables this once a
 * dedicated sandbox image is published; the test skips otherwise.</p>
 */
class DockerSandboxRunnerIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void runsCommandsInAHardenedDisposableSandbox() throws IOException {
        String image = System.getenv("SANDBOX_IT_IMAGE");
        Assumptions.assumeTrue(image != null && !image.isBlank(),
            "SANDBOX_IT_IMAGE is not set; skipping the Docker sandbox smoke test");

        Map<String, String> env = new HashMap<>();
        env.put("SANDBOX_MODE", "docker");
        env.put("SANDBOX_IMAGE", image);
        env.put("SANDBOX_MEMORY_MB", "256");
        env.put("SANDBOX_PIDS", "128");
        env.put("SANDBOX_NOFILE", "256");
        env.put("SANDBOX_TMPFS_MB", "64");
        env.put("SANDBOX_EXEC_TIMEOUT_SECONDS", "30");
        String user = currentUser();
        env.put("SANDBOX_USER", user);
        if (user.startsWith("0:")) {
            env.put("SANDBOX_ALLOW_ROOT", "true");
        }

        SandboxConfig config = SandboxConfig.from(env::get);
        Path workspace = Files.createDirectories(tempDir.resolve("workspace"));
        Files.writeString(workspace.resolve("hello.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace));
            try {
                ExecResult read = runner.exec(handle,
                    ExecRequest.of("cat hello.txt", Duration.ofSeconds(20)));
                assertTrue(read.passed(), read.output());
                assertTrue(read.output().contains("hello"), read.output());

                ExecResult write = runner.exec(handle,
                    ExecRequest.of("echo written > out.txt && cat out.txt", Duration.ofSeconds(20)));
                assertTrue(write.passed(), write.output());
                assertTrue(write.output().contains("written"), write.output());
                assertTrue(Files.exists(workspace.resolve("out.txt")));

                ExecResult readOnly = runner.exec(handle, ExecRequest.of(
                    "touch /etc/sandbox-escape 2>/dev/null || echo READONLY",
                    Duration.ofSeconds(20)));
                assertTrue(readOnly.output().contains("READONLY"), readOnly.output());

                ExecResult socket = runner.exec(handle, ExecRequest.of(
                    "test ! -S /var/run/docker.sock && echo NOSOCKET",
                    Duration.ofSeconds(20)));
                assertTrue(socket.output().contains("NOSOCKET"), socket.output());

                ExecResult secrets = runner.exec(handle,
                    ExecRequest.of("env", Duration.ofSeconds(20)));
                assertFalse(secrets.output().contains("AI_API_KEY="), secrets.output());
                assertFalse(secrets.output().contains("GITHUB_TOKEN="), secrets.output());
                assertFalse(secrets.output().contains("POSTGRES_PASSWORD="), secrets.output());

                ExecResult memory = runner.exec(handle, ExecRequest.of(
                    "cat /sys/fs/cgroup/memory.max 2>/dev/null || "
                        + "cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo unknown",
                    Duration.ofSeconds(20)));
                String limit = memory.output().trim();
                if (limit.matches("\\d+")) {
                    assertTrue(Long.parseLong(limit) <= 256L * 1024 * 1024,
                        "memory limit was not applied: " + limit);
                }
            } finally {
                runner.destroy(handle);
            }
        }
    }

    private static String currentUser() {
        try {
            String status = Files.readString(Path.of("/proc/self/status"));
            String uid = null;
            String gid = null;
            for (String line : status.lines().toList()) {
                if (line.startsWith("Uid:")) {
                    uid = line.trim().split("\\s+")[1];
                } else if (line.startsWith("Gid:")) {
                    gid = line.trim().split("\\s+")[1];
                }
            }
            if (uid != null && gid != null) {
                return uid + ":" + gid;
            }
        } catch (IOException | RuntimeException ignored) {
            // Fall through to the configured default.
        }
        return SandboxConfig.DEFAULT_USER;
    }
}
