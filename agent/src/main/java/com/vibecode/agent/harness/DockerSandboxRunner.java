package com.vibecode.agent.harness;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Disposable Docker sandbox for repo-controlled commands.
 *
 * <p>Each sandbox is a sibling container with a read-only rootfs, only the
 * workspace bind-mounted writable, a non-root user, dropped capabilities, no
 * host Docker socket, resource limits, and no network by default. A failed
 * create/exec throws; there is no host fallback.</p>
 */
public final class DockerSandboxRunner implements SandboxRunner {

    private static final Logger log = LoggerFactory.getLogger(DockerSandboxRunner.class);
    private static final Duration CREATE_TIMEOUT = Duration.ofSeconds(90);
    private static final Duration INSPECT_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration COPY_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration CONTROL_TIMEOUT = Duration.ofSeconds(30);
    private static final int CONTROL_OUTPUT_BYTES = 16_384;
    private static final String LABEL = "vibecode.sandbox.managed=true";

    private final SandboxConfig config;
    private final Set<String> active = ConcurrentHashMap.newKeySet();
    private final Set<String> created = ConcurrentHashMap.newKeySet();

    public DockerSandboxRunner(SandboxConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Sandbox config is required");
        }
        if (!config.isDocker()) {
            throw new IllegalArgumentException("DockerSandboxRunner requires SANDBOX_MODE=docker");
        }
        config.validate();
        this.config = config;
    }

    @Override
    public SandboxHandle create(SandboxSpec spec) throws IOException {
        if (spec == null) {
            throw new IOException("Sandbox spec is required");
        }
        if (spec.networkEnabled()) {
            throw new IOException(
                "Sandbox network allowlist is not implemented yet (fg-34 slice 2); refusing to start");
        }
        Path workspace = SandboxPaths.validateWorkspace(spec.workspace());
        String name = "vibecode-sandbox-" + UUID.randomUUID().toString()
            .replace("-", "").substring(0, 12);

        List<String> command = new ArrayList<>();
        command.add(config.dockerBinary());
        command.addAll(buildCreateArgs(spec, name));
        DockerResult result = runDocker(command, CREATE_TIMEOUT, CONTROL_OUTPUT_BYTES);
        if (result.timedOut() || result.exitCode() != 0) {
            destroyByName(name);
            throw new IOException("Could not start sandbox '" + name + "': "
                + (result.timedOut() ? "docker run timed out" : result.output()));
        }

        DockerResult inspect = runDocker(
            List.of(config.dockerBinary(), "inspect", "-f", "{{.State.Running}}", name),
            INSPECT_TIMEOUT,
            1_024
        );
        if (!"true".equals(inspect.output().trim())) {
            destroyByName(name);
            throw new IOException("Sandbox '" + name + "' is not running: " + inspect.output());
        }

        created.add(name);
        active.add(name);
        log.info("Started sandbox {} (image {}, workspace {})",
            name, spec.image(), spec.mountSource());
        return new SandboxHandle(name, workspace, false, Instant.now());
    }

    @Override
    public ExecResult exec(SandboxHandle handle, ExecRequest request) throws IOException {
        requireActive(handle);
        List<String> command = new ArrayList<>();
        command.add(config.dockerBinary());
        command.addAll(buildExecArgs(handle, request));

        DockerResult result = runDocker(command, request.timeout(), request.maxOutputBytes());
        if (result.timedOut()) {
            // A hung process may have spawned children; killing only the local
            // `docker exec` client is not enough. Kill the container (and its
            // whole process tree) so the run fails closed.
            stop(handle);
            return new ExecResult(request.command(), -1, result.output(), true, result.truncated());
        }
        return new ExecResult(
            request.command(), result.exitCode(), result.output(), false, result.truncated());
    }

    @Override
    public void putFile(SandboxHandle handle, Path local, String remote) throws IOException {
        requireActive(handle);
        if (local == null || !Files.isRegularFile(local)) {
            throw new IOException("Sandbox upload must be a regular file: " + local);
        }
        String target = SandboxPaths.containerPath(remote);
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "cp", local.toString(), handle.id() + ":" + target),
            COPY_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        if (result.exitCode() != 0 || result.timedOut()) {
            throw new IOException("Could not upload " + local + " to " + target + ": "
                + result.output());
        }
    }

    @Override
    public void getFile(SandboxHandle handle, String remote, Path local) throws IOException {
        requireActive(handle);
        String source = SandboxPaths.containerPath(remote);
        if (local.getParent() != null) {
            Files.createDirectories(local.getParent());
        }
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "cp", handle.id() + ":" + source, local.toString()),
            COPY_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        if (result.exitCode() != 0 || result.timedOut()) {
            throw new IOException("Could not download " + source + " to " + local + ": "
                + result.output());
        }
    }

    @Override
    public void stop(SandboxHandle handle) {
        if (handle == null) {
            return;
        }
        active.remove(handle.id());
        runControl(List.of(config.dockerBinary(), "kill", "--signal", "KILL", handle.id()));
    }

    @Override
    public void destroy(SandboxHandle handle) {
        if (handle == null) {
            return;
        }
        destroyByName(handle.id());
        active.remove(handle.id());
        created.remove(handle.id());
    }

    @Override
    public void close() {
        for (String name : new ArrayList<>(created)) {
            destroyByName(name);
        }
        created.clear();
        active.clear();
    }

    private void requireActive(SandboxHandle handle) throws IOException {
        if (handle == null) {
            throw new IOException("Sandbox handle is required");
        }
        if (handle.host()) {
            throw new IOException("DockerSandboxRunner cannot operate on a host sandbox handle");
        }
        if (!active.contains(handle.id())) {
            throw new IOException("Sandbox is not running: " + handle.id());
        }
    }

    private void destroyByName(String name) {
        runControl(List.of(config.dockerBinary(), "rm", "-f", name));
    }

    private void runControl(List<String> command) {
        try {
            DockerResult result = runDocker(command, CONTROL_TIMEOUT, CONTROL_OUTPUT_BYTES);
            if (result.exitCode() != 0 && !result.timedOut()) {
                log.debug("Sandbox control command failed: {} -> {}",
                    command, result.output());
            }
        } catch (RuntimeException e) {
            log.debug("Sandbox control command failed: {}: {}", command, e.getMessage());
        }
    }

    private DockerResult runDocker(List<String> command, Duration timeout, int maxOutputBytes) {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectErrorStream(true);
        EnvironmentSanitizer.sanitize(builder.environment());
        copyDockerEnvironment(builder.environment());

        BoundedTailBuffer output = new BoundedTailBuffer(maxOutputBytes);
        Process process = null;
        try {
            process = builder.start();
            Process running = process;
            Thread reader = new Thread(() -> {
                try (InputStream input = running.getInputStream()) {
                    input.transferTo(output);
                } catch (IOException e) {
                    log.debug("Docker output reader stopped: {}", e.getMessage());
                }
            }, "sandbox-docker-output");
            reader.setDaemon(true);
            reader.start();

            boolean finished = process.waitFor(
                Math.max(1, timeout.toMillis()), TimeUnit.MILLISECONDS);
            if (!finished) {
                ProcessGroup.kill(process);
                reader.join(2_000);
                return new DockerResult(-1, output.text(), true, output.truncated());
            }
            reader.join(2_000);
            return new DockerResult(process.exitValue(), output.text(), false, output.truncated());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                ProcessGroup.kill(process);
            }
            return new DockerResult(-1, output.text(), true, output.truncated());
        } catch (IOException e) {
            return new DockerResult(-1, e.getMessage(), false, false);
        }
    }

    /**
     * The daemon connection must survive the secret sanitizer, but no host
     * credential is passed into the sandbox itself.
     */
    private static void copyDockerEnvironment(Map<String, String> environment) {
        for (String name : List.of(
            "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
            "DOCKER_CONTEXT", "DOCKER_CONFIG"
        )) {
            String value = System.getenv(name);
            if (value != null && !value.isBlank()) {
                environment.put(name, value);
            }
        }
    }

    /**
     * Build the argument list after the docker binary. Package-visible so tests
     * can assert the hardening flags without a daemon.
     */
    static List<String> buildCreateArgs(
        SandboxSpec spec,
        String name
    ) {
        List<String> args = new ArrayList<>();
        args.add("run");
        args.add("-d");
        args.add("--name");
        args.add(name);
        args.add("--label");
        args.add(LABEL);

        // The base image is immutable; only the workspace (and /tmp) is writable.
        args.add("--read-only");
        args.add("--tmpfs");
        args.add("/tmp:rw,nosuid,nodev,size=" + spec.limits().tmpfsBytes());

        String mount = spec.mountSource().toString();
        args.add("-v");
        args.add(mount + ":" + SandboxPaths.CONTAINER_WORKSPACE + ":rw");
        Path gitDir = spec.mountSource().resolve(".git");
        if (Files.isDirectory(gitDir, LinkOption.NOFOLLOW_LINKS)
            && !Files.isSymbolicLink(gitDir)) {
            // Repo code may read git metadata, but publishing owns .git.
            args.add("-v");
            args.add(gitDir + ":" + SandboxPaths.CONTAINER_WORKSPACE + "/.git:ro");
        }

        args.add("-w");
        args.add(SandboxPaths.CONTAINER_WORKSPACE);
        args.add("--user");
        args.add(spec.user());
        args.add("--cap-drop");
        args.add("ALL");
        args.add("--security-opt");
        args.add("no-new-privileges");
        if (spec.seccompProfile() != null) {
            args.add("--security-opt");
            args.add("seccomp=" + spec.seccompProfile());
        }
        if (spec.apparmorProfile() != null) {
            args.add("--security-opt");
            args.add("apparmor=" + spec.apparmorProfile());
        }

        SandboxConfig.Limits limits = spec.limits();
        args.add("--pids-limit");
        args.add(String.valueOf(limits.pids()));
        args.add("--memory");
        args.add(String.valueOf(limits.memoryBytes()));
        args.add("--memory-swap");
        args.add(String.valueOf(limits.memoryBytes()));
        args.add("--cpus");
        args.add(limits.cpus());
        args.add("--ulimit");
        args.add("nofile=" + limits.openFiles() + ":" + limits.openFiles());
        if (limits.diskBytes() > 0) {
            // Bounds a single file even when the writable layer is tmpfs.
            args.add("--ulimit");
            args.add("fsize=" + limits.diskBytes());
        }
        if (limits.diskEnforced()) {
            args.add("--storage-opt");
            args.add("size=" + limits.diskBytes());
        }

        args.add("--init");
        // Slice 1 is default-deny. The allowlist proxy is fg-34 slice 2.
        args.add("--network");
        args.add("none");

        for (Map.Entry<String, String> entry : containerEnvironment(spec).entrySet()) {
            args.add("-e");
            args.add(entry.getKey() + "=" + entry.getValue());
        }

        args.add("--entrypoint");
        args.add("/bin/sh");
        args.add(spec.image());
        args.add("-c");
        args.add("while :; do sleep 3600; done");
        return args;
    }

    /** Build the argument list after the docker binary for one exec. */
    static List<String> buildExecArgs(
        SandboxHandle handle,
        ExecRequest request
    ) throws IOException {
        List<String> args = new ArrayList<>();
        args.add("exec");
        args.add("-w");
        args.add(SandboxPaths.containerCwd(request.cwd()));
        for (Map.Entry<String, String> entry : request.env().entrySet()) {
            args.add("-e");
            args.add(entry.getKey() + "=" + entry.getValue());
        }
        args.add(handle.id());
        args.add("/bin/sh");
        args.add("-lc");
        args.add(request.command());
        return args;
    }

    /**
     * Non-secret environment passed to the container. HOME/TMPDIR point at the
     * writable tmpfs because the rootfs is read-only.
     */
    static Map<String, String> containerEnvironment(SandboxSpec spec) {
        Map<String, String> env = new LinkedHashMap<>(spec.env());
        env.putIfAbsent("HOME", "/tmp");
        env.putIfAbsent("TMPDIR", "/tmp");
        env.putIfAbsent("XDG_CACHE_HOME", "/tmp/.cache");
        env.putIfAbsent("NPM_CONFIG_CACHE", "/tmp/npm-cache");
        SandboxSecurity.validateEnv(env, "sandbox environment");
        return env;
    }

    private record DockerResult(int exitCode, String output, boolean timedOut, boolean truncated) {
    }
}
