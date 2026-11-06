package com.vibecode.agent.harness;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Compatibility runner that executes commands on the supervisor host.
 *
 * <p>This is the Phase 1 behaviour and is <strong>not</strong> a security
 * boundary. It exists only for local development and for preserving the
 * existing harness until Docker mode is enabled; never use it for untrusted
 * repo code in production.</p>
 */
public final class HostSandboxRunner implements SandboxRunner {

    private static final Logger log = LoggerFactory.getLogger(HostSandboxRunner.class);
    private static final boolean WINDOWS = System.getProperty("os.name", "")
        .toLowerCase().contains("win");

    @Override
    public SandboxHandle create(SandboxSpec spec) throws IOException {
        Path workspace = SandboxPaths.validateWorkspace(spec == null ? null : spec.workspace());
        return new SandboxHandle("host", workspace, true, Instant.now());
    }

    @Override
    public ExecResult exec(SandboxHandle handle, ExecRequest request) throws IOException {
        requireHost(handle);
        Path cwd = SandboxPaths.resolveCwd(handle.workspace(), request.cwd());

        List<String> command = WINDOWS
            ? List.of("cmd.exe", "/c", request.command())
            : List.of("sh", "-c", request.command());
        ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(command));
        builder.directory(cwd.toFile());
        builder.redirectErrorStream(true);
        EnvironmentSanitizer.sanitize(builder.environment());
        builder.environment().putAll(request.env());

        Process process = null;
        try {
            process = builder.start();
            BoundedTailBuffer output = new BoundedTailBuffer(request.maxOutputBytes());
            Process running = process;
            Thread reader = new Thread(() -> {
                try (InputStream input = running.getInputStream()) {
                    input.transferTo(output);
                } catch (IOException e) {
                    log.debug("Sandbox output reader stopped: {}", e.getMessage());
                }
            }, "sandbox-host-output");
            reader.setDaemon(true);
            reader.start();

            boolean finished = process.waitFor(
                request.timeout().toMillis(), TimeUnit.MILLISECONDS);
            int exitCode = finished ? process.exitValue() : -1;

            // A command can exit while a background child survives. Kill the
            // whole group before joining the reader.
            ProcessGroup.kill(process);
            reader.join(5_000);
            return new ExecResult(
                request.command(),
                exitCode,
                output.text(),
                !finished,
                output.truncated()
            );
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                ProcessGroup.kill(process);
            }
            return new ExecResult(request.command(), -1, "interrupted", false, false);
        }
    }

    @Override
    public void putFile(SandboxHandle handle, Path local, String remote) throws IOException {
        requireHost(handle);
        if (local == null || !Files.isRegularFile(local)) {
            throw new IOException("Sandbox upload must be a regular file: " + local);
        }
        Path target = SandboxPaths.remoteToLocal(handle.workspace(), remote);
        if (target.getParent() != null) {
            Files.createDirectories(target.getParent());
        }
        Files.copy(local, target, StandardCopyOption.REPLACE_EXISTING);
    }

    @Override
    public void getFile(SandboxHandle handle, String remote, Path local) throws IOException {
        requireHost(handle);
        Path source = SandboxPaths.remoteToLocal(handle.workspace(), remote);
        if (!Files.isRegularFile(source)) {
            throw new IOException("Sandbox file does not exist: " + remote);
        }
        if (local.getParent() != null) {
            Files.createDirectories(local.getParent());
        }
        Files.copy(source, local, StandardCopyOption.REPLACE_EXISTING);
    }

    @Override
    public void stop(SandboxHandle handle) {
        // Commands are killed by exec(); nothing else is running.
    }

    @Override
    public void destroy(SandboxHandle handle) {
        // Nothing to destroy on the host.
    }

    @Override
    public void close() {
        // Nothing to release.
    }

    private static void requireHost(SandboxHandle handle) throws IOException {
        if (handle == null || !handle.host()) {
            throw new IOException("HostSandboxRunner requires a host sandbox handle");
        }
    }
}
