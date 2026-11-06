package com.vibecode.agent.harness;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
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
import java.util.concurrent.atomic.AtomicLong;

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
    private final Thread shutdownHook;
    private final WatchdogFactory watchdogFactory;
    private final Set<String> active = ConcurrentHashMap.newKeySet();
    private final Set<String> created = ConcurrentHashMap.newKeySet();
    private final Map<String, Duration> maxDurations = new ConcurrentHashMap<>();
    private final Map<String, Long> artifactLimits = new ConcurrentHashMap<>();
    private final Map<String, AtomicBoolean> quotaFlags = new ConcurrentHashMap<>();
    private final Map<String, ScheduledExecutorService> watchdogs = new ConcurrentHashMap<>();
    private final Map<String, Process> runningProcesses = new ConcurrentHashMap<>();
    private final Map<String, EgressRuntime> egress = new ConcurrentHashMap<>();

    public DockerSandboxRunner(SandboxConfig config) {
        this(config, null);
    }

    DockerSandboxRunner(SandboxConfig config, WatchdogFactory watchdogFactory) {
        if (config == null) {
            throw new IllegalArgumentException("Sandbox config is required");
        }
        if (!config.isDocker()) {
            throw new IllegalArgumentException("DockerSandboxRunner requires SANDBOX_MODE=docker");
        }
        config.validate();
        this.config = config;
        this.watchdogFactory = watchdogFactory;
        this.shutdownHook = new Thread(this::close, "sandbox-shutdown");
        Runtime.getRuntime().addShutdownHook(shutdownHook);
    }

    /** Test seam for the watchdog scheduler. */
    @FunctionalInterface
    interface WatchdogFactory {
        ScheduledExecutorService start(String name, Path workspace, AtomicBoolean exceeded);
    }

    @Override
    public SandboxHandle create(SandboxSpec spec) throws IOException {
        if (spec == null) {
            throw new IOException("Sandbox spec is required");
        }
        Path workspace = SandboxPaths.validateWorkspace(spec.workspace());
        String name = "vibecode-sandbox-" + UUID.randomUUID().toString()
            .replace("-", "").substring(0, 12);

        EgressRuntime egressRuntime = null;
        if (spec.networkEnabled()) {
            egressRuntime = startEgress(name, spec);
            egress.put(name, egressRuntime);
        }

        List<String> command = new ArrayList<>();
        command.add(config.dockerBinary());
        try {
            command.addAll(buildCreateArgs(spec, name, egressRuntime));
        } catch (RuntimeException e) {
            destroyByName(name);
            throw new IOException("Could not build the sandbox command", e);
        }
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
        AtomicBoolean quotaExceeded = new AtomicBoolean(false);
        quotaFlags.put(name, quotaExceeded);
        ScheduledExecutorService watchdog;
        try {
            watchdog = startDiskWatchdog(name, workspace, quotaExceeded);
        } catch (RuntimeException e) {
            // Never leave a container running because its watchdog could not
            // be scheduled. Retain tracking if removal itself fails so close()
            // can retry (and D9 can reap it after a hard kill).
            if (!destroyByName(name)) {
                log.warn("Sandbox {} could not be removed after watchdog startup "
                    + "failure; retaining tracking for close/retry", name);
            } else {
                created.remove(name);
            }
            active.remove(name);
            maxDurations.remove(name);
            artifactLimits.remove(name);
            quotaFlags.remove(name);
            throw new IOException("Could not start the sandbox watchdog", e);
        }
        if (watchdog != null) {
            watchdogs.put(name, watchdog);
        }
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

        AtomicBoolean quotaExceeded =
            quotaFlags.getOrDefault(handle.id(), new AtomicBoolean(false));
        try {
            DockerResult result = runDocker(
                command, effective.timeout(), effective.maxOutputBytes(), handle.id());
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
            // A command that exits normally can leave daemonized children
            // behind in the container's PID namespace. They must not keep
            // editing the workspace between verification and publishing.
            if (active.contains(handle.id())) {
                killDescendants(handle);
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
        long remoteSize = assertContainerSourceSafe(handle, source);
        long limit = artifactLimits.getOrDefault(handle.id(), 0L);
        if (limit > 0 && remoteSize > limit) {
            throw new IOException("Artifact " + source + " is " + remoteSize
                + " bytes, over SANDBOX_ARTIFACT_MAX_BYTES=" + limit);
        }

        Path parent = local.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Path temp = Files.createTempFile(
            parent == null ? Path.of(".") : parent, ".sandbox-download-", ".tmp");
        try {
            DockerResult result = runDocker(
                List.of(config.dockerBinary(), "cp",
                    handle.id() + ":" + source, temp.toString()),
                COPY_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (result.exitCode() != 0 || result.timedOut()) {
                throw new IOException("Could not download " + source + " to " + local + ": "
                    + result.output());
            }
            if (limit > 0 && Files.size(temp) > limit) {
                throw new IOException("Downloaded artifact " + source
                    + " exceeds SANDBOX_ARTIFACT_MAX_BYTES=" + limit);
            }
            Files.move(temp, local, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    @Override
    public void stop(SandboxHandle handle) {
        if (handle == null) {
            return;
        }
        stopByName(handle.id());
    }

    @Override
    public void destroy(SandboxHandle handle) throws IOException {
        if (handle == null) {
            return;
        }
        if (!destroyByName(handle.id())) {
            throw new IOException("Could not destroy sandbox " + handle.id()
                + "; it may still be running. The supervisor must not publish.");
        }
        stopWatchdog(handle.id());
        active.remove(handle.id());
        created.remove(handle.id());
        maxDurations.remove(handle.id());
        artifactLimits.remove(handle.id());
        quotaFlags.remove(handle.id());
        runningProcesses.remove(handle.id());
    }

    @Override
    public void close() {
        for (String name : new ArrayList<>(created)) {
            if (destroyByName(name)) {
                created.remove(name);
            } else {
                log.warn("Sandbox {} is still present after close; startup reaping is D9", name);
            }
        }
        for (ScheduledExecutorService watchdog : new ArrayList<>(watchdogs.values())) {
            watchdog.shutdownNow();
        }
        for (String name : new ArrayList<>(egress.keySet())) {
            stopEgress(name);
        }
        active.clear();
        maxDurations.clear();
        artifactLimits.clear();
        quotaFlags.clear();
        watchdogs.clear();
        runningProcesses.clear();
        egress.clear();
        if (created.isEmpty()) {
            try {
                Runtime.getRuntime().removeShutdownHook(shutdownHook);
            } catch (IllegalStateException ignored) {
                // Already shutting down; the hook is running this method.
            }
        } else {
            log.warn("Retaining the sandbox shutdown hook; {} container(s) still tracked",
                created.size());
        }
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

    private void stopByName(String name) {
        stopWatchdog(name);
        stopContainer(name);
        stopEgress(name);
    }

    private void stopContainer(String name) {
        active.remove(name);
        runControl(List.of(config.dockerBinary(), "kill", "--signal", "KILL", name));
    }

    /**
     * Remove the container and prove it is gone. Returns false when the
     * container may still be running; callers must not publish in that case.
     */
    private boolean destroyByName(String name) {
        DockerResult removed = runDocker(
            List.of(config.dockerBinary(), "rm", "-f", name),
            CONTROL_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        boolean gone = !removed.timedOut() && removed.exitCode() == 0;
        if (!gone) {
            DockerResult inspect = runDocker(
                List.of(config.dockerBinary(), "inspect", "-f", "{{.State.Running}}", name),
                INSPECT_TIMEOUT,
                1_024
            );
            String combined = (removed.output() + "\n" + inspect.output()).toLowerCase();
            if (combined.contains("no such container") || combined.contains("no such object")) {
                gone = true;
            } else {
                log.warn("Could not destroy sandbox {} (rm exit {}, inspect exit {}): {}",
                    name, removed.exitCode(), inspect.exitCode(), combined.trim());
            }
        }
        // The sandbox may still exist; always attempt to remove its egress
        // network and proxy so a later retry does not leak them.
        stopEgress(name);
        return gone;
    }

    private void stopWatchdog(String name) {
        ScheduledExecutorService watchdog = watchdogs.remove(name);
        if (watchdog != null) {
            watchdog.shutdownNow();
        }
    }

    private void killRunningProcess(String name) {
        Process running = runningProcesses.get(name);
        if (running != null) {
            ProcessGroup.kill(running);
        }
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
     * Kill every process in the container except PID 1 and the cleanup shell
     * itself. {@code docker exec} shares the container PID namespace, so a
     * normal command exit would otherwise leave daemonized children editing the
     * bind-mounted workspace after verification.
     */
    private void killDescendants(SandboxHandle handle) {
        // Bounded repeated sweep: a child that forks between enumeration and
        // kill is picked up by the next pass. This narrows the fork race but
        // is still not a hard guarantee (D14).
        String script = "n=0; "
            + "while [ $n -lt 5 ]; do "
            + "  found=0; "
            + "  for d in /proc/[0-9]*; do "
            + "    p=${d#/proc/}; "
            + "    [ \"$p\" = \"1\" ] && continue; "
            + "    [ \"$p\" = \"$$\" ] && continue; "
            + "    if kill -9 \"$p\" 2>/dev/null; then found=1; fi; "
            + "  done; "
            + "  [ $found -eq 0 ] && break; "
            + "  n=$((n+1)); "
            + "done; "
            + "echo OK";
        try {
            DockerResult result = runDocker(
                List.of(config.dockerBinary(), "exec",
                    handle.id(), "/bin/sh", "-c", script),
                CONTROL_TIMEOUT,
                1_024,
                handle.id()
            );
            if (result.timedOut() || result.exitCode() != 0
                || !"OK".equals(result.output().trim())) {
                log.warn("Sandbox {} descendant cleanup failed; stopping it", handle.id());
                stop(handle);
            }
        } catch (RuntimeException e) {
            log.warn("Sandbox {} descendant cleanup failed: {}", handle.id(), e.getMessage());
            stop(handle);
        }
    }

    /**
     * Watch the supervisor-visible workspace for the sandbox lifetime.
     * {@code --storage-opt} bounds the container writable layer, not a bind
     * mount, so this is the real total quota. Measurement failure fails closed.
     */
    private ScheduledExecutorService startDiskWatchdog(
        String name,
        Path workspace,
        AtomicBoolean exceeded
    ) {
        long limit = config.limits().diskBytes();
        if (limit <= 0) {
            return null;
        }
        long interval = Math.max(1, config.diskCheckInterval().toSeconds());
        if (watchdogFactory != null) {
            return watchdogFactory.start(name, workspace, exceeded);
        }
        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "sandbox-disk-" + name);
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleAtFixedRate(() -> {
            if (exceeded.get()) {
                return;
            }
            try {
                long size = workspaceSize(workspace);
                if (size < 0) {
                    exceeded.set(true);
                    log.warn("Sandbox {} could not measure its workspace; failing closed", name);
                    killRunningProcess(name);
                    stopContainer(name);
                    stopWatchdog(name);
                    return;
                }
                if (size > limit) {
                    exceeded.set(true);
                    log.warn(
                        "Sandbox {} exceeded the workspace quota ({} > {} bytes); killing it",
                        name, size, limit);
                    killRunningProcess(name);
                    stopContainer(name);
                    stopWatchdog(name);
                }
            } catch (RuntimeException e) {
                // A lazy Files.walk can throw during iteration. Never let the
                // scheduled task cancel silently and disable the quota.
                exceeded.set(true);
                log.warn("Sandbox {} quota check failed; failing closed: {}",
                    name, e.getMessage());
                killRunningProcess(name);
                stopContainer(name);
                stopWatchdog(name);
            }
        }, interval, interval, TimeUnit.SECONDS);
        return executor;
    }

    /** Package-visible for tests: total size of regular files under the workspace. */
    static long workspaceSize(Path root) {
        AtomicLong total = new AtomicLong();
        AtomicBoolean failed = new AtomicBoolean(false);
        try {
            Files.walkFileTree(root, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (attrs.isRegularFile() && !Files.isSymbolicLink(file)) {
                        total.addAndGet(attrs.size());
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    failed.set(true);
                    return FileVisitResult.CONTINUE;
                }
            });
            return failed.get() ? -1L : total.get();
        } catch (IOException | RuntimeException e) {
            log.debug("Could not measure sandbox workspace {}: {}", root, e.getMessage());
            return -1L;
        }
    }

    /**
     * Run a fail-closed guard inside the container.
     *
     * <p>The guard must exit zero, not time out, and print an explicit
     * {@code OK} sentinel. An empty output with a non-zero exit is a failure,
     * never a pass.</p>
     */
    private DockerResult runGuard(SandboxHandle handle, String script) throws IOException {
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "exec", handle.id(), "/bin/sh", "-c", script),
            CONTROL_TIMEOUT,
            1_024
        );
        if (result.timedOut()) {
            throw new IOException("Sandbox file-copy guard timed out");
        }
        if (result.exitCode() != 0) {
            throw new IOException("Sandbox file-copy guard failed (exit "
                + result.exitCode() + "): " + result.output());
        }
        return result;
    }

    /**
     * Reject a download whose container path is a symlink, non-regular file,
     * or resolves outside {@code /workspace}. Returns the size measured inside
     * the container so the artifact cap is applied before {@code docker cp}.
     */
    private long assertContainerSourceSafe(SandboxHandle handle, String source)
        throws IOException {
        String quoted = shellQuote(source);
        // Exit codes, not stdout, are authoritative: a same-UID process can
        // flood the guard's stdout, but it cannot change the shell's status.
        String script = "p=" + quoted + "; "
            + "if [ -L \"$p\" ]; then echo SYMLINK; exit 11; fi; "
            + "if [ ! -f \"$p\" ]; then echo NOTFILE; exit 12; fi; "
            + "r=$(readlink -f \"$p\" 2>/dev/null || true); "
            + "case \"$r\" in /workspace|/workspace/*) ;; *) echo ESCAPE; exit 13;; esac; "
            + "s=$(wc -c < \"$p\" 2>/dev/null || echo -1); "
            + "echo \"OK $s\"";
        String output = runGuard(handle, script).output().trim();
        if (!output.startsWith("OK ")) {
            throw new IOException(
                "Refusing to copy a symlinked, non-regular or outside-workspace path: "
                    + source + " (" + output + ")");
        }
        try {
            long size = Long.parseLong(output.substring(3).trim());
            if (size < 0) {
                throw new IOException("Guard could not size " + source);
            }
            return size;
        } catch (NumberFormatException e) {
            throw new IOException("Guard returned an invalid size for " + source
                + ": " + output, e);
        }
    }

    /**
     * Create the upload parent only after proving the target is a regular file
     * (or absent) and its ancestor chain has no symlink escaping
     * {@code /workspace}.
     */
    private void prepareContainerParent(SandboxHandle handle, String target)
        throws IOException {
        String parent = parentOf(target);
        String quotedParent = shellQuote(parent);
        String script = "p=" + shellQuote(target) + "; "
            + "if [ -L \"$p\" ]; then echo SYMLINK; exit 21; fi; "
            + "if [ -e \"$p\" ] && [ ! -f \"$p\" ]; then echo NOTFILE; exit 22; fi; "
            + "d=" + quotedParent + "; "
            + "while [ \"$d\" != \"/workspace\" ] && [ \"$d\" != \"/\" ] && [ \"$d\" != \".\" ]; do "
            + "  if [ -L \"$d\" ]; then echo SYMLINK; exit 23; fi; "
            + "  d=$(dirname \"$d\"); "
            + "done; "
            + "mkdir -p " + quotedParent + " 2>/dev/null || { echo MKDIRFAILED; exit 24; }; "
            + "r=$(readlink -f " + quotedParent + " 2>/dev/null || true); "
            + "case \"$r\" in /workspace|/workspace/*) echo OK ;; *) echo ESCAPE; exit 25 ;; esac";
        String output = runGuard(handle, script).output().trim();
        if (!"OK".equals(output)) {
            throw new IOException(
                "Refusing to copy a symlinked, non-regular or outside-workspace path: "
                    + target + " (" + output + ")");
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
        return runDocker(command, timeout, maxOutputBytes, null);
    }

    private DockerResult runDocker(
        List<String> command,
        Duration timeout,
        int maxOutputBytes,
        String sandboxId
    ) {
        ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(command));
        builder.redirectErrorStream(true);
        EnvironmentSanitizer.sanitize(builder.environment());
        copyDockerEnvironment(builder.environment());

        BoundedTailBuffer output = new BoundedTailBuffer(maxOutputBytes);
        Process process = null;
        try {
            process = builder.start();
            if (sandboxId != null) {
                runningProcesses.put(sandboxId, process);
            }
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
            if (sandboxId != null && process != null) {
                runningProcesses.remove(sandboxId, process);
            }
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

    /** Handle for one sandbox's egress proxy and internal network. */
    record EgressRuntime(
        String network,
        String proxyName,
        String proxyAddress,
        String proxyUrl
    ) {
    }

    private static volatile String proxyScriptCommand;

    /**
     * Create the proxy-only internal network and start the allowlist proxy.
     * The sandbox joins only the internal network, so it has no default route
     * and every outbound connection must pass through the proxy.
     */
    private EgressRuntime startEgress(String sandboxName, SandboxSpec spec) throws IOException {
        String suffix = sandboxName.startsWith("vibecode-sandbox-")
            ? sandboxName.substring("vibecode-sandbox-".length())
            : sandboxName;
        String network = "vibecode-egress-" + suffix;
        String proxy = "vibecode-egress-proxy-" + suffix;
        try {
            DockerResult created = runDocker(
                List.of(config.dockerBinary(), "network", "create",
                    "--driver", "bridge", "--internal", "--label", LABEL, network),
                CREATE_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (created.timedOut() || created.exitCode() != 0) {
                throw new IOException("Could not create egress network '" + network + "': "
                    + created.output());
            }

            List<String> proxyCommand = new ArrayList<>();
            proxyCommand.add(config.dockerBinary());
            proxyCommand.addAll(buildProxyRunArgs(spec, proxy, network));
            DockerResult started = runDocker(proxyCommand, CREATE_TIMEOUT, CONTROL_OUTPUT_BYTES);
            if (started.timedOut() || started.exitCode() != 0) {
                throw new IOException("Could not start egress proxy '" + proxy + "': "
                    + started.output());
            }

            DockerResult inspect = runDocker(
                List.of(config.dockerBinary(), "inspect", "-f", "{{.State.Running}}", proxy),
                INSPECT_TIMEOUT,
                1_024
            );
            if (!"true".equals(inspect.output().trim())) {
                throw new IOException("Egress proxy '" + proxy + "' is not running: "
                    + inspect.output());
            }
            awaitProxyReady(proxy);

            // The proxy is attached to the internal network at start. Give it
            // the upstream network only after it is healthy so a broken proxy
            // cannot leave the sandbox with direct egress.
            DockerResult connected = runDocker(
                List.of(config.dockerBinary(), "network", "connect",
                    spec.egressUpstreamNetwork(), proxy),
                CREATE_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (connected.timedOut() || connected.exitCode() != 0) {
                throw new IOException("Could not attach egress proxy '" + proxy
                    + "' to '" + spec.egressUpstreamNetwork() + "': " + connected.output());
            }

            DockerResult address = runDocker(
                List.of(config.dockerBinary(), "inspect", "-f",
                    "{{index .NetworkSettings.Networks \"" + network + "\" \"IPAddress\"}}",
                    proxy),
                INSPECT_TIMEOUT,
                1_024
            );
            String proxyAddress = address.output().trim();
            if (address.exitCode() != 0 || !proxyAddress.matches("[0-9a-fA-F:.]+")) {
                throw new IOException("Could not determine the egress proxy address: "
                    + address.output());
            }

            log.info("Started egress proxy {} on internal network {} (upstream {})",
                proxy, network, spec.egressUpstreamNetwork());
            String urlHost = proxyAddress.contains(":")
                ? "[" + proxyAddress + "]"
                : proxyAddress;
            return new EgressRuntime(network, proxy, proxyAddress,
                "http://" + urlHost + ":3128");
        } catch (IOException | RuntimeException e) {
            stopEgress(network, proxy);
            throw e instanceof IOException io ? io : new IOException(e);
        }
    }

    /** Build the hardened proxy container arguments. Package-visible for tests. */
    static List<String> buildProxyRunArgs(SandboxSpec spec, String proxyName, String network) {
        List<String> args = new ArrayList<>();
        args.add("run");
        args.add("-d");
        args.add("--name");
        args.add(proxyName);
        args.add("--label");
        args.add(LABEL);
        args.add("--read-only");
        args.add("--tmpfs");
        args.add("/tmp:rw,nosuid,nodev,size="
            + Math.min(spec.limits().tmpfsBytes(), 64L * 1024 * 1024));
        args.add("--user");
        args.add(spec.user());
        args.add("--cap-drop");
        args.add("ALL");
        args.add("--security-opt");
        args.add("no-new-privileges");
        args.add("--pids-limit");
        args.add("64");
        args.add("--memory");
        args.add("134217728");
        args.add("--cpus");
        args.add("0.5");
        args.add("--log-opt");
        args.add("max-size=1m");
        args.add("--log-opt");
        args.add("max-file=1");
        args.add("--network");
        args.add(network);
        args.add("-e");
        args.add("EGRESS_PORT=3128");
        args.add("-e");
        args.add("EGRESS_ALLOWED_HOSTS=" + String.join(",", spec.allowedHosts()));
        args.add("--entrypoint");
        args.add("node");
        args.add(spec.proxyImage());
        args.add("-e");
        try {
            args.add(proxyCommand());
        } catch (IOException e) {
            throw new IllegalStateException("Could not load the egress proxy script", e);
        }
        return args;
    }

    private static String proxyCommand() throws IOException {
        if (proxyScriptCommand == null) {
            try (InputStream input = DockerSandboxRunner.class
                .getResourceAsStream("/sandbox/egress-proxy.js")) {
                if (input == null) {
                    throw new IOException("Missing sandbox/egress-proxy.js resource");
                }
                String encoded = Base64.getEncoder().encodeToString(input.readAllBytes());
                proxyScriptCommand =
                    "eval(Buffer.from('" + encoded + "','base64').toString('utf8'))";
            }
        }
        return proxyScriptCommand;
    }

    private void awaitProxyReady(String proxy) throws IOException {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            DockerResult logs = runDocker(
                List.of(config.dockerBinary(), "logs", "--tail", "20", proxy),
                CONTROL_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (logs.output().contains("egress proxy listening")) {
                return;
            }
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while waiting for the egress proxy", e);
            }
        }
        throw new IOException("Egress proxy '" + proxy + "' did not become ready");
    }

    private void stopEgress(String name) {
        EgressRuntime runtime = egress.remove(name);
        if (runtime != null) {
            stopEgress(runtime.network(), runtime.proxyName());
        }
    }

    private void stopEgress(String network, String proxyName) {
        // Surface denials before the container is removed. The proxy logs one
        // JSON line per decision.
        DockerResult logs = runDocker(
            List.of(config.dockerBinary(), "logs", "--tail", "200", proxyName),
            CONTROL_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        for (String line : logs.output().split("\n")) {
            if (line.contains("\"decision\":\"deny\"")) {
                log.warn("Sandbox egress denied: {}", line.trim());
            }
        }
        DockerResult proxyRemoved = runDocker(
            List.of(config.dockerBinary(), "rm", "-f", proxyName),
            CONTROL_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        if (proxyRemoved.exitCode() != 0 && !proxyRemoved.timedOut()
            && !proxyRemoved.output().toLowerCase().contains("no such")) {
            log.warn("Could not remove the egress proxy {}: {}",
                proxyName, proxyRemoved.output().trim());
        }
        DockerResult networkRemoved = runDocker(
            List.of(config.dockerBinary(), "network", "rm", network),
            CONTROL_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        if (networkRemoved.exitCode() != 0 && !networkRemoved.timedOut()
            && !networkRemoved.output().toLowerCase().contains("not found")
            && !networkRemoved.output().toLowerCase().contains("no such")) {
            log.warn("Could not remove the egress network {}: {}",
                network, networkRemoved.output().trim());
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
        return buildCreateArgs(spec, name, null);
    }

    static List<String> buildCreateArgs(
        SandboxSpec spec,
        String name,
        EgressRuntime egress
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

        // No --init: PID 1 must remain the shell loop so the post-exec
        // descendant sweep can kill everything else without exiting the
        // container. --pids-limit and the sweep bound runaway children.
        // Network is default-deny unless an egress allowlist is configured; in
        // that case the sandbox joins only the proxy's internal network and
        // resolves nothing: external DNS would be an untracked exfiltration
        // channel. The proxy is addressed by IP and also pinned in /etc/hosts.
        args.add("--network");
        args.add(egress == null ? "none" : egress.network());
        if (egress != null) {
            args.add("--dns");
            args.add("127.0.0.1");
            args.add("--add-host");
            args.add(egress.proxyName() + ":" + egress.proxyAddress());
        }

        for (Map.Entry<String, String> entry : containerEnvironment(spec, egress).entrySet()) {
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
        return containerEnvironment(spec, null);
    }

    static Map<String, String> containerEnvironment(SandboxSpec spec, EgressRuntime egress) {
        Map<String, String> env = new LinkedHashMap<>(spec.env());
        env.putIfAbsent("HOME", "/tmp");
        env.putIfAbsent("TMPDIR", "/tmp");
        env.putIfAbsent("XDG_CACHE_HOME", "/tmp/.cache");
        env.putIfAbsent("NPM_CONFIG_CACHE", "/tmp/npm-cache");
        if (egress != null) {
            String proxyUrl = egress.proxyUrl();
            for (String key : List.of(
                "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                "http_proxy", "https_proxy", "all_proxy",
                "npm_config_proxy", "npm_config_https_proxy")) {
                env.putIfAbsent(key, proxyUrl);
            }
            env.putIfAbsent("NO_PROXY", "localhost,127.0.0.1,::1");
            env.putIfAbsent("no_proxy", "localhost,127.0.0.1,::1");
        }
        SandboxSecurity.validateEnv(env, "sandbox environment");
        return env;
    }

    private record DockerResult(int exitCode, String output, boolean timedOut, boolean truncated) {
    }
}
