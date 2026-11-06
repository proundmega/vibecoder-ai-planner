package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
    void runsCommandsAsANonRootUserInADisposableSandbox() throws Exception {
        String image = System.getenv("SANDBOX_IT_IMAGE");
        Assumptions.assumeTrue(image != null && !image.isBlank(),
            "SANDBOX_IT_IMAGE is not set; skipping the Docker sandbox smoke test");
        Assumptions.assumeTrue(
            FileSystems.getDefault().supportedFileAttributeViews().contains("posix"),
            "POSIX permissions are required for the non-root smoke test");

        SandboxConfig config = integrationConfig(image, Map.of());
        Path workspace = Files.createDirectories(tempDir.resolve("workspace"));
        // The host may run as root; make the mount writable by the non-root
        // sandbox user so the test verifies the boundary, not file ownership.
        Files.setPosixFilePermissions(workspace, PosixFilePermissions.fromString("rwxrwxrwx"));
        Files.writeString(workspace.resolve("hello.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace));
            try {
                ExecResult whoami = runner.exec(handle,
                    ExecRequest.of("id -u", Duration.ofSeconds(20)));
                assertEquals("1000", whoami.output().trim());

                ExecResult read = runner.exec(handle,
                    ExecRequest.of("cat hello.txt", Duration.ofSeconds(20)));
                assertTrue(read.passed(), read.output());
                assertTrue(read.output().contains("hello"), read.output());

                ExecResult write = runner.exec(handle,
                    ExecRequest.of("echo written > out.txt && cat out.txt", Duration.ofSeconds(20)));
                assertTrue(write.passed(), write.output());
                assertTrue(write.output().contains("written"), write.output());
                assertTrue(Files.exists(workspace.resolve("out.txt")));

                Path upload = Files.writeString(tempDir.resolve("upload.txt"), "artifact");
                runner.putFile(handle, upload, "/workspace/upload.txt");
                Path download = tempDir.resolve("download.txt");
                runner.getFile(handle, "/workspace/upload.txt", download);
                assertEquals("artifact", Files.readString(download));

                ExecResult link = runner.exec(handle,
                    ExecRequest.of("ln -s /etc/passwd leak", Duration.ofSeconds(20)));
                assertTrue(link.passed(), link.output());
                assertThrows(IOException.class,
                    () -> runner.getFile(handle, "/workspace/leak",
                        tempDir.resolve("leak.out")));
                assertThrows(IOException.class,
                    () -> runner.putFile(handle, upload, "/workspace/leak"));

                ExecResult background = runner.exec(handle, ExecRequest.of(
                    "sh -c '(sleep 2; echo late > late.txt) >/dev/null 2>&1 &' ; true",
                    Duration.ofSeconds(20)));
                assertTrue(background.passed(), background.output());
                Thread.sleep(2_500);
                assertFalse(Files.exists(workspace.resolve("late.txt")),
                    "background process survived a normal exec");

                ExecResult lifecycle = runner.exec(handle, ExecRequest.of(
                    "printf '#!/bin/sh\\n(sleep 2; echo pwned > lifecycle.txt) "
                        + ">/dev/null 2>&1 &\\n' "
                        + "> postinstall.sh && chmod +x postinstall.sh && ./postinstall.sh",
                    Duration.ofSeconds(20)));
                assertTrue(lifecycle.passed(), lifecycle.output());
                Thread.sleep(2_500);
                assertFalse(Files.exists(workspace.resolve("lifecycle.txt")),
                    "postinstall-like child survived a normal exec");

                ExecResult fifo = runner.exec(handle,
                    ExecRequest.of("mkfifo fifo", Duration.ofSeconds(20)));
                assertTrue(fifo.passed(), fifo.output());
                assertThrows(IOException.class,
                    () -> runner.putFile(handle, upload, "/workspace/fifo"));

                ExecResult big = runner.exec(handle, ExecRequest.of(
                    "dd if=/dev/zero of=big.bin bs=1M count=2 2>/dev/null",
                    Duration.ofSeconds(20)));
                assertTrue(big.passed(), big.output());
                Path bigDownload = tempDir.resolve("big.bin");
                assertThrows(IOException.class,
                    () -> runner.getFile(handle, "/workspace/big.bin", bigDownload));
                assertFalse(Files.exists(bigDownload),
                    "an over-cap download must be rejected before docker cp");

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

    @Test
    void enforcesTheWorkspaceDiskQuota() throws IOException {
        String image = System.getenv("SANDBOX_IT_IMAGE");
        Assumptions.assumeTrue(image != null && !image.isBlank(),
            "SANDBOX_IT_IMAGE is not set; skipping the Docker sandbox smoke test");
        Assumptions.assumeTrue(
            FileSystems.getDefault().supportedFileAttributeViews().contains("posix"),
            "POSIX permissions are required for the non-root smoke test");

        SandboxConfig config = integrationConfig(image, Map.of(
            "SANDBOX_DISK_MB", "1",
            "SANDBOX_DISK_CHECK_INTERVAL_SECONDS", "1"
        ));
        Path workspace = Files.createDirectories(tempDir.resolve("quota"));
        Files.setPosixFilePermissions(workspace, PosixFilePermissions.fromString("rwxrwxrwx"));

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace));
            try {
                ExecResult result = runner.exec(handle, ExecRequest.of(
                    "i=1; while [ $i -le 6 ]; do "
                        + "dd if=/dev/zero of=big$i bs=1M count=1 2>/dev/null; "
                        + "i=$((i+1)); sleep 1; done",
                    Duration.ofSeconds(30)));
                assertTrue(result.timedOut(), result.output());
                assertTrue(result.output().contains("workspace disk quota exceeded"),
                    result.output());
            } finally {
                runner.destroy(handle);
            }
        }
    }

    @Test
    void allowsOnlyTheConfiguredEgressHostsAndBlocksDirectAccess() throws IOException {
        Assumptions.assumeTrue("1".equals(System.getenv("SANDBOX_IT_NETWORK")),
            "SANDBOX_IT_NETWORK=1 is not set; skipping the egress allowlist smoke test");
        String image = System.getenv("SANDBOX_IT_NETWORK_IMAGE");
        Assumptions.assumeTrue(image != null && !image.isBlank(),
            "SANDBOX_IT_NETWORK_IMAGE must name an image with node and curl");
        Assumptions.assumeTrue(
            FileSystems.getDefault().supportedFileAttributeViews().contains("posix"),
            "POSIX permissions are required for the non-root smoke test");

        SandboxConfig config = integrationConfig(image, Map.of(
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
        ));
        Path workspace = Files.createDirectories(tempDir.resolve("egress"));
        Files.setPosixFilePermissions(workspace, PosixFilePermissions.fromString("rwxrwxrwx"));

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace));
            try {
                ExecResult allowed = runner.exec(handle, ExecRequest.of(
                    "curl -fsS --max-time 15 -o /dev/null https://registry.npmjs.org/ "
                        + "&& echo ALLOWED || echo DENIED",
                    Duration.ofSeconds(30)));
                assertTrue(allowed.output().contains("ALLOWED"), allowed.output());

                ExecResult denied = runner.exec(handle, ExecRequest.of(
                    "curl -fsS --max-time 15 -o /dev/null https://example.org/ "
                        + "&& echo ALLOWED || echo DENIED",
                    Duration.ofSeconds(30)));
                assertTrue(denied.output().contains("DENIED"), denied.output());

                // Even an allowlisted proxy cannot be bypassed by clearing the
                // proxy environment: the internal network has no default route.
                ExecResult direct = runner.exec(handle, ExecRequest.of(
                    "env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY "
                        + "-u http_proxy -u https_proxy -u all_proxy "
                        + "curl -fsS --max-time 10 -o /dev/null https://registry.npmjs.org/ "
                        + "&& echo ALLOWED || echo DENIED",
                    Duration.ofSeconds(30)));
                assertTrue(direct.output().contains("DENIED"), direct.output());

                ExecResult metadata = runner.exec(handle, ExecRequest.of(
                    "curl -fsS --max-time 5 -o /dev/null http://169.254.169.254/ "
                        + "&& echo ALLOWED || echo DENIED",
                    Duration.ofSeconds(30)));
                assertTrue(metadata.output().contains("DENIED"), metadata.output());
            } finally {
                runner.destroy(handle);
            }
        }
    }

    private static SandboxConfig integrationConfig(String image, Map<String, String> extra) {
        Map<String, String> env = new HashMap<>();
        env.put("SANDBOX_MODE", "docker");
        env.put("SANDBOX_IMAGE", image);
        env.put("SANDBOX_USER", "1000:1000");
        env.put("SANDBOX_MEMORY_MB", "256");
        env.put("SANDBOX_PIDS", "128");
        env.put("SANDBOX_NOFILE", "256");
        env.put("SANDBOX_TMPFS_MB", "64");
        env.put("SANDBOX_EXEC_TIMEOUT_SECONDS", "30");
        env.put("SANDBOX_ARTIFACT_MAX_BYTES", "1024");
        env.putAll(extra);
        return SandboxConfig.from(env::get);
    }
}
