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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

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
    private final Map<String, Duration> maxDurations = new ConcurrentHashMap<>();
    private final Map<String, Long> artifactLimits = new ConcurrentHashMap<>();
    private volatile Process currentDockerProcess;

    public DockerSandboxRunner(SandboxConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Sandbox config is required");
        }
        if (!config.isDocker()) {
            throw new IllegalArgumentException("DockerSandboxRunner requires SANDBOX_MODE=docker");
        }
        config.validate();
        this.config = config;
        Runtime.getRuntime().addShutdownHook(
            new Thread(this::close, "sandbox-shutdown"));
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
        maxDurations.put(name, spec.maxDuration());
        artifactLimits.put(name, spec.artifactMaxBytes());
        log.info("Started sandbox {} (image {}, workspace {})",
            name, spec.image(), spec.mountSource());
        return new SandboxHandle(name, workspace, false, Instant.now());
    }

    @Override
    public ExecResult exec(SandboxHandle handle, ExecRequest request) throws IOException {
        requireActive(handle);

        Duration timeout = request.timeout();
        Duration maxDuration = maxDurations.get(handle.id());
        if (maxDuration != null && timeout.compareTo(maxDuration) > 0) {
            timeout = maxDuration;
        }
        ExecRequest effective = new ExecRequest(
            request.command(), request.cwd(), timeout,
            request.maxOutputBytes(), request.env());

        List<String> command = new ArrayList<>();
        command.add(config.dockerBinary());
        command.addAll(buildExecArgs(handle, effective));

        AtomicBoolean quotaExceeded = new AtomicBoolean(false);
        ScheduledExecutorService watchdog = startDiskWatchdog(handle, quotaExceeded);
        try {
            DockerResult result = runDocker(
                command, effective.timeout(), effective.maxOutputBytes());
            if (quotaExceeded.get()) {
                return new ExecResult(
                    request.command(),
                    -1,
                    result.output() + "\nworkspace disk quota exceeded",
                    true,
                    result.truncated()
                );
            }
            if (result.timedOut()) {
                // A hung process may have spawned children; killing only the
                // local `docker exec` client is not enough. Kill the container
                // (and its whole process tree) so the run fails closed.
                stop(handle);
                return new ExecResult(
                    request.command(), -1, result.output(), true, result.truncated());
            }
            return new ExecResult(
                request.command(), result.exitCode(), result.output(), false, result.truncated());
        } finally {
            if (watchdog != null) {
                watchdog.shutdownNow();
            }
        }
    }

    @Override
    public void putFile(SandboxHandle handle, Path local, String remote) throws IOException {
        requireActive(handle);
        if (local == null || !Files.isRegularFile(local)) {
            throw new IOException("Sandbox upload must be a regular file: " + local);
        }
        long limit = artifactLimits.getOrDefault(handle.id(), 0L);
        long size = Files.size(local);
        if (limit > 0 && size > limit) {
            throw new IOException("Upload " + local + " is " + size
                + " bytes, over SANDBOX_ARTIFACT_MAX_BYTES=" + limit);
        }
        String target = SandboxPaths.containerPath(remote);
        prepareContainerParent(handle, target);
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
        assertContainerSourceSafe(handle, source);
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
        long limit = artifactLimits.getOrDefault(handle.id(), 0L);
        if (limit > 0 && Files.exists(local) && Files.size(local) > limit) {
            Files.deleteIfExists(local);
            throw new IOException("Downloaded artifact " + source
                + " exceeds SANDBOX_ARTIFACT_MAX_BYTES=" + limit);
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
        maxDurations.remove(handle.id());
        artifactLimits.remove(handle.id());
    }

    @Override
    public void close() {
        for (String name : new ArrayList<>(created)) {
            destroyByName(name);
        }
        created.clear();
        active.clear();
        maxDurations.clear();
        artifactLimits.clear();
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

    /**
     * Watch the supervisor-visible workspace size. {@code --storage-opt}
     * bounds the container writable layer, not a bind mount, so this is the
     * real total quota. The per-file {@code fsize} ulimit remains in place as
     * a fast burst guard.
     */
    private ScheduledExecutorService startDiskWatchdog(
        SandboxHandle handle,
        AtomicBoolean exceeded
    ) {
        long limit = config.limits().diskBytes();
        if (limit <= 0) {
            return null;
        }
        long interval = Math.max(1, config.diskCheckInterval().toSeconds());
        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "sandbox-disk-" + handle.id());
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleAtFixedRate(() -> {
            if (exceeded.get()) {
                return;
            }
            long size = workspaceSize(handle.workspace());
            if (size > limit) {
                exceeded.set(true);
                log.warn("Sandbox {} exceeded the workspace quota ({} > {} bytes); killing it",
                    handle.id(), size, limit);
                Process running = currentDockerProcess;
                if (running != null) {
                    ProcessGroup.kill(running);
                }
                stop(handle);
            }
        }, interval, interval, TimeUnit.SECONDS);
        return executor;
    }

    /** Package-visible for tests: total size of regular files under the workspace. */
    static long workspaceSize(Path root) {
        try (var stream = Files.walk(root)) {
            return stream
                .filter(path -> !Files.isSymbolicLink(path))
                .filter(Files::isRegularFile)
                .mapToLong(path -> {
                    try {
                        return Files.size(path);
                    } catch (IOException e) {
                        return 0L;
                    }
                })
                .sum();
        } catch (IOException e) {
            log.debug("Could not measure sandbox workspace {}: {}", root, e.getMessage());
            return -1L;
        }
    }

    /**
     * Reject a download whose container path is a symlink or resolves outside
     * {@code /workspace}. {@code docker cp} follows symlinks, so the check has
     * to happen inside the container first.
     */
    private void assertContainerSourceSafe(SandboxHandle handle, String source)
        throws IOException {
        String quoted = shellQuote(source);
        String script = "p=" + quoted + "; "
            + "if [ -L \"$p\" ]; then echo SYMLINK; exit 0; fi; "
            + "if [ ! -f \"$p\" ]; then echo NOTFILE; exit 0; fi; "
            + "r=$(readlink -f \"$p\" 2>/dev/null || true); "
            + "if [ -z \"$r\" ]; then echo MISSING; "
            + "elif [ \"$r\" != \"/workspace\" ] && [ \"${r#/workspace/}\" = \"$r\" ]; then echo ESCAPE; fi";
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "exec", handle.id(), "/bin/sh", "-c", script),
            CONTROL_TIMEOUT,
            1_024
        );
        String output = result.output().trim();
        if (output.contains("SYMLINK") || output.contains("ESCAPE")
            || output.contains("MISSING") || output.contains("NOTFILE")) {
            throw new IOException(
                "Refusing to copy a non-regular, symlinked or outside-workspace path: " + source);
        }
    }

    /**
     * Create the upload parent inside the container only after proving its
     * ancestor chain has no symlink escaping {@code /workspace}.
     */
    private void prepareContainerParent(SandboxHandle handle, String target)
        throws IOException {
        String parent = parentOf(target);
        String quoted = shellQuote(parent);
        String script = "p=" + shellQuote(target) + "; "
            + "if [ -L \"$p\" ]; then echo SYMLINK; exit 0; fi; "
            + "d=" + quoted + "; "
            + "while [ \"$d\" != \"/workspace\" ] && [ \"$d\" != \"/\" ] && [ \"$d\" != \".\" ]; do "
            + "  if [ -L \"$d\" ]; then echo SYMLINK; exit 0; fi; "
            + "  d=$(dirname \"$d\"); "
            + "done; "
            + "mkdir -p " + quoted + " 2>/dev/null || true; "
            + "r=$(readlink -f " + quoted + " 2>/dev/null || true); "
            + "if [ -z \"$r\" ]; then echo MISSING; "
            + "elif [ \"$r\" != \"/workspace\" ] && [ \"${r#/workspace/}\" = \"$r\" ]; then echo ESCAPE; fi";
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "exec", handle.id(), "/bin/sh", "-c", script),
            CONTROL_TIMEOUT,
            1_024
        );
        String output = result.output().trim();
        if (output.contains("SYMLINK") || output.contains("ESCAPE") || output.contains("MISSING")) {
            throw new IOException(
                "Refusing to copy through a symlink or outside /workspace: " + target);
        }
    }

    private static String parentOf(String path) {
        int slash = path.lastIndexOf('/');
        return slash <= 0 ? SandboxPaths.CONTAINER_WORKSPACE : path.substring(0, slash);
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
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
            currentDockerProcess = process;
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
        } finally {
            currentDockerProcess = null;
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
        // Check .git on the supervisor-visible path: with a daemon-path mapping
        // the mount source is not visible inside a containerized agent, but the
        // workspace is. Mount the mapped path read-only to keep .git immutable.
        Path supervisorGit = spec.workspace().resolve(".git");
        Path mountGit = spec.mountSource().resolve(".git");
        if (Files.isDirectory(supervisorGit, LinkOption.NOFOLLOW_LINKS)
            && !Files.isSymbolicLink(supervisorGit)) {
            args.add("-v");
            args.add(mountGit + ":" + SandboxPaths.CONTAINER_WORKSPACE + "/.git:ro");
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
            // Fast per-file burst guard. The total workspace quota is enforced
            // by the supervisor-side watchdog (a bind mount is not covered by
            // --storage-opt).
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
