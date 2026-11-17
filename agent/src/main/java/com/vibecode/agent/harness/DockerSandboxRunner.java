package com.vibecode.agent.harness;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CoderResult;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.function.Supplier;

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
    private static final SecretRedactor LOG_REDACTOR = SecretRedactor.patternsOnly();
    private static final Duration CREATE_TIMEOUT = Duration.ofSeconds(90);
    private static final Duration INSPECT_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration COPY_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration CONTROL_TIMEOUT = Duration.ofSeconds(30);
    private static final int CONTROL_OUTPUT_BYTES = 16_384;
    // The proxy's per-use audit line can be older than 200 denial lines, so
    // read a much larger bounded window at teardown. The creation-time trust
    // log remains the durable record if this window is ever exceeded.
    private static final int PROXY_LOG_TAIL = 10_000;
    private static final int PROXY_LOG_OUTPUT_BYTES = 4 * 1024 * 1024;
    private static final int PROXY_DENIAL_WARN_LIMIT = 200;
    private static final String LABEL = "vibecode.sandbox.managed=true";

    private final SandboxConfig config;
    private final Thread shutdownHook;
    private final WatchdogFactory watchdogFactory;
    private final Set<String> active = ConcurrentHashMap.newKeySet();
    private final Set<String> created = ConcurrentHashMap.newKeySet();
    private final Map<String, Duration> maxDurations = new ConcurrentHashMap<>();
    private final Map<String, Long> artifactLimits = new ConcurrentHashMap<>();
    private final Map<String, Map<String, String>> execEnvironments =
        new ConcurrentHashMap<>();
    private final Map<String, AtomicBoolean> quotaFlags = new ConcurrentHashMap<>();
    private final Map<String, ScheduledExecutorService> watchdogs = new ConcurrentHashMap<>();
    private final Map<String, Process> runningProcesses = new ConcurrentHashMap<>();
    private final Map<String, EgressRuntime> egress = new ConcurrentHashMap<>();
    private final Map<String, ServiceRuntime> services = new ConcurrentHashMap<>();
    // One exec at a time per sandbox: the post-exec freeze must not catch
    // another in-flight command and destroy the container for doing so.
    private final Map<String, ReentrantLock> execLocks = new ConcurrentHashMap<>();
    // A quiescence failure means the workspace may already contain survivor
    // writes. Such a handle must never be treated as cleanly destroyed.
    private final Set<String> compromised = ConcurrentHashMap.newKeySet();

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


    /** Runtime state for one sandbox's profile service containers. */
    static final class ServiceRuntime {
        private final String network;
        private final List<String> containers;
        private final Map<String, String> environment;
        private final Map<String, String> hosts;

        ServiceRuntime(
            String network,
            List<String> containers,
            Map<String, String> environment,
            Map<String, String> hosts
        ) {
            this.network = network;
            this.containers = List.copyOf(containers);
            this.environment = Map.copyOf(environment);
            this.hosts = Map.copyOf(hosts);
        }

        String network() {
            return network;
        }

        List<String> containers() {
            return containers;
        }

        Map<String, String> environment() {
            return environment;
        }

        Map<String, String> hosts() {
            return hosts;
        }

        @Override
        public String toString() {
            return "ServiceRuntime{network=" + network
                + ", containers=" + containers
                + ", environmentKeys=" + environment.keySet()
                + ", hosts=" + hosts.keySet() + "}";
        }
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

        ServiceRuntime serviceRuntime = startServices(name, spec);
        if (serviceRuntime != null) {
            services.put(name, serviceRuntime);
        }

        EgressRuntime egressRuntime = null;
        try {
            if (spec.networkEnabled()) {
                egressRuntime = startEgress(name, spec);
                egress.put(name, egressRuntime);
            }
        } catch (IOException | RuntimeException e) {
            destroyByName(name);
            throw e instanceof IOException io ? io : new IOException(e);
        }

        List<String> command = new ArrayList<>();
        command.add(config.dockerBinary());
        Path serviceEnvFile = null;
        try {
            if (serviceRuntime != null && !serviceRuntime.environment().isEmpty()) {
                serviceEnvFile = writeEnvironmentFile(serviceRuntime.environment());
            }
            command.addAll(buildCreateArgs(
                spec, name, egressRuntime, serviceRuntime, serviceEnvFile));
        } catch (IOException | RuntimeException e) {
            deleteQuietly(serviceEnvFile);
            destroyByName(name);
            throw e instanceof IOException io ? io
                : new IOException("Could not build the sandbox command", e);
        }
        DockerResult result;
        try {
            result = runDocker(command, CREATE_TIMEOUT, CONTROL_OUTPUT_BYTES);
        } finally {
            deleteQuietly(serviceEnvFile);
        }
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

        if (serviceRuntime != null && egressRuntime != null) {
            DockerResult connected = runDocker(
                List.of(config.dockerBinary(), "network", "connect",
                    egressRuntime.network(), name),
                CREATE_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (connected.timedOut() || connected.exitCode() != 0) {
                destroyByName(name);
                throw new IOException("Could not attach sandbox '" + name
                    + "' to the egress network: " + connected.output());
            }
        }

        try {
            provisionEgressTrust(name, egressRuntime, spec);
        } catch (IOException | RuntimeException e) {
            destroyByName(name);
            execEnvironments.remove(name);
            throw e instanceof IOException io ? io : new IOException(e);
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
            execEnvironments.remove(name);
            quotaFlags.remove(name);
            throw new IOException("Could not start the sandbox watchdog", e);
        }
        if (watchdog != null) {
            watchdogs.put(name, watchdog);
        }
        log.info("Started sandbox {} (image {}, workspace {}, services {})",
            name, spec.image(), spec.mountSource(), spec.services().size());
        return new SandboxHandle(name, workspace, false, Instant.now());
    }

    @Override
    public ExecResult exec(SandboxHandle handle, ExecRequest request) throws IOException {
        return withHandleLock(handle, () -> execSerialized(handle, request, null));
    }

    @Override
    public ExecResult execStreaming(
        SandboxHandle handle,
        ExecRequest request,
        Consumer<String> listener
    ) throws IOException {
        return withHandleLock(handle, () -> execSerialized(handle, request, listener));
    }

    @FunctionalInterface
    private interface IoAction<T> {
        T run() throws IOException;
    }

    /**
     * Serialize every container operation (exec and file transfer) per
     * handle. A post-exec freeze must not catch another in-flight command, and
     * {@code docker cp} must not race a paused container.
     */
    private <T> T withHandleLock(SandboxHandle handle, IoAction<T> action)
        throws IOException {
        requireActive(handle);
        ReentrantLock lock = execLocks.computeIfAbsent(
            handle.id(), ignored -> new ReentrantLock());
        lock.lock();
        try {
            // Re-check after waiting: a concurrent stop/destroy may have
            // removed the sandbox while this call was queued.
            requireActive(handle);
            return action.run();
        } finally {
            lock.unlock();
            if (!active.contains(handle.id())) {
                execLocks.remove(handle.id(), lock);
            }
        }
    }

    private ExecResult execSerialized(
        SandboxHandle handle,
        ExecRequest request,
        Consumer<String> listener
    ) throws IOException {
        Duration timeout = request.timeout();
        Duration maxDuration = maxDurations.get(handle.id());
        if (maxDuration != null && timeout.compareTo(maxDuration) > 0) {
            timeout = maxDuration;
        }
        ExecRequest effective = new ExecRequest(
            request.command(), request.cwd(), timeout,
            request.maxOutputBytes(),
            mergeExecEnvironment(execEnvironments.get(handle.id()), request.env()));

        List<String> command = new ArrayList<>();
        command.add(config.dockerBinary());
        command.addAll(buildExecArgs(handle, effective));

        AtomicBoolean quotaExceeded =
            quotaFlags.getOrDefault(handle.id(), new AtomicBoolean(false));
        try {
            DockerResult result = runDockerStreaming(
                command, effective.timeout(), effective.maxOutputBytes(), handle.id(), listener);
            if (quotaExceeded.get()) {
                // The watchdog stops the container, but verify it here too so
                // the post-exec sweep never runs against a half-stopped
                // container. The result is already a failure.
                stopVerified(handle, "the workspace quota was exceeded");
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
                // local `docker exec` client is not enough. Stop the container
                // and verify it, then report the timeout (already a failure).
                stopVerified(handle, "the exec timed out");
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
        withHandleLock(handle, () -> {
            putFileLocked(handle, local, remote);
            return null;
        });
    }

    private void putFileLocked(SandboxHandle handle, Path local, String remote)
        throws IOException {
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
        withHandleLock(handle, () -> {
            getFileLocked(handle, remote, local);
            return null;
        });
    }

    private void getFileLocked(SandboxHandle handle, String remote, Path local)
        throws IOException {
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
            int maxBytes = limit > 0
                ? (int) Math.min(limit, Integer.MAX_VALUE - 16_384L)
                : 64 * 1024 * 1024;
            copyContainerFile(handle.id(), source, temp, maxBytes, COPY_TIMEOUT);
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
        forgetExecLock(handle.id());
    }

    @Override
    public void destroy(SandboxHandle handle) throws IOException {
        if (handle == null) {
            return;
        }
        if (compromised.contains(handle.id())) {
            // The container may be gone, but the workspace was not verified.
            // Clean up best-effort and refuse to report it as clean so the
            // pre-publish gate cannot treat the handle as publishable.
            try {
                destroyInternal(handle);
            } catch (IOException e) {
                log.warn("Compromised sandbox {} cleanup failed; a container may remain: {}",
                    handle.id(), e.getMessage());
            }
            throw new IOException("Sandbox " + handle.id()
                + " was compromised by an unverified quiescence check; "
                + "refusing to publish its workspace");
        }
        destroyInternal(handle);
    }

    private void destroyInternal(SandboxHandle handle) throws IOException {
        if (!destroyByName(handle.id())) {
            throw new IOException("Could not destroy sandbox " + handle.id()
                + "; it may still be running. The supervisor must not publish.");
        }
        stopWatchdog(handle.id());
        active.remove(handle.id());
        created.remove(handle.id());
        maxDurations.remove(handle.id());
        artifactLimits.remove(handle.id());
        execEnvironments.remove(handle.id());
        quotaFlags.remove(handle.id());
        runningProcesses.remove(handle.id());
        forgetExecLock(handle.id());
        // A compromised flag is terminal: it is retained until close() so any
        // later destroy() still refuses to report the handle as publishable.
    }

    private void forgetExecLock(String id) {
        ReentrantLock lock = execLocks.get(id);
        if (lock != null && !lock.isLocked() && !lock.hasQueuedThreads()) {
            execLocks.remove(id, lock);
        }
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
        execEnvironments.clear();
        quotaFlags.clear();
        watchdogs.clear();
        runningProcesses.clear();
        egress.clear();
        services.clear();
        execLocks.clear();
        compromised.clear();
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
        if (compromised.contains(handle.id())) {
            throw new IOException("Sandbox is compromised by an unverified quiescence "
                + "check and cannot run more commands: " + handle.id());
        }
        if (!active.contains(handle.id())) {
            throw new IOException("Sandbox is not running: " + handle.id());
        }
    }

    private void stopByName(String name) {
        stopWatchdog(name);
        stopContainer(name);
        stopServices(name);
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
                    name, removed.exitCode(), inspect.exitCode(),
                    LOG_REDACTOR.redact(combined.trim()));
            }
        }
        // The sandbox may still exist; always attempt to remove its service
        // containers/network and egress proxy/network so a later retry does not
        // leak them.
        stopServices(name);
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
                    command, LOG_REDACTOR.redact(result.output()));
            }
        } catch (RuntimeException e) {
            log.debug("Sandbox control command failed: {}: {}", command, e.getMessage());
        }
    }

    /**
     * Kill every process in the container except its init and the cleanup
     * shell itself. {@code docker exec} shares the container PID namespace, so
     * a normal command exit would otherwise leave daemonized children editing
     * the bind-mounted workspace after verification.
     *
     * <p>The repeated sweep narrows the fork race, but a child can still fork
     * between the last enumeration and the next kill. To close that race the
     * container is frozen with {@code docker pause} (cgroup freezer) and its
     * process table is inspected while frozen: no process can fork once the
     * freeze completes, so only the init process should remain. If a survivor
     * remains, or the freeze cannot be verified, the sandbox is destroyed so
     * nothing can write to the workspace afterwards (D14).</p>
     */
    private void killDescendants(SandboxHandle handle) throws IOException {
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
                stopOrFail(handle, "descendant cleanup failed");
                return;
            }
        } catch (RuntimeException e) {
            log.warn("Sandbox {} descendant cleanup failed: {}", handle.id(), e.getMessage());
            stopOrFail(handle, "descendant cleanup threw");
            return;
        }
        verifyQuiescent(handle);
    }

    /**
     * Freeze the container, confirm only its init process (and zombies)
     * remains, then thaw it. Any doubt destroys the sandbox (fail closed).
     */
    private void verifyQuiescent(SandboxHandle handle) throws IOException {
        DockerResult paused = runDocker(
            List.of(config.dockerBinary(), "pause", handle.id()),
            CONTROL_TIMEOUT,
            1_024
        );
        if (paused.timedOut() || paused.exitCode() != 0) {
            destroyUnverified(handle, "could not be paused for the final sweep: "
                + LOG_REDACTOR.redact(paused.output().trim()));
            return;
        }

        long initPid = initHostPid(handle);
        if (initPid <= 0) {
            destroyUnverified(handle, "could not determine the init host PID");
            return;
        }

        boolean quiescent;
        try {
            // `docker top` passes the options to the host ps; Docker requires
            // the PID title in the first line, so do not suppress the header.
            DockerResult top = runDocker(
                List.of(config.dockerBinary(), "top", handle.id(),
                    "-eo", "pid,stat,comm"),
                CONTROL_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            boolean stateAware = usableProcessTable(top);
            if (!stateAware) {
                log.debug("Sandbox {} does not support 'top -eo pid,stat,comm' ({}); "
                    + "falling back to the portable ps -ef output",
                    handle.id(), LOG_REDACTOR.redact(top.output().trim()));
                // Without a state column, zombies are not exempt, so an
                // unexpected table fails closed.
                top = runDocker(
                    List.of(config.dockerBinary(), "top", handle.id()),
                    CONTROL_TIMEOUT,
                    CONTROL_OUTPUT_BYTES
                );
            }
            if (!usableProcessTable(top)) {
                // An empty, failed or truncated table cannot prove that the
                // workspace is quiescent.
                log.warn("Sandbox {} process table was blank, failed or truncated "
                    + "while paused (exit {}, timedOut={}, truncated={}): {}",
                    handle.id(), top.exitCode(), top.timedOut(), top.truncated(),
                    LOG_REDACTOR.redact(top.output().trim()));
                quiescent = false;
            } else if (!containsInitRow(top.output(), stateAware, initPid)) {
                // A header-only table is not proof that the init process was
                // observed; require its row before trusting the table.
                log.warn("Sandbox {} process table did not contain the init host "
                    + "PID {}; treating it as unverified", handle.id(), initPid);
                quiescent = false;
            } else {
                List<String> survivors = parseSurvivors(top.output(), stateAware, initPid);
                quiescent = survivors.isEmpty();
                if (!quiescent) {
                    log.warn("Sandbox {} still has {} process(es) after the sweep "
                        + "(fork race): {}", handle.id(), survivors.size(),
                        LOG_REDACTOR.redact(survivors.toString()));
                }
            }
        } catch (RuntimeException e) {
            log.warn("Sandbox {} process table check failed: {}", handle.id(), e.getMessage());
            quiescent = false;
        }

        if (!quiescent) {
            destroyUnverified(handle, "was not quiescent after the final sweep");
            return;
        }

        DockerResult resumed = runDocker(
            List.of(config.dockerBinary(), "unpause", handle.id()),
            CONTROL_TIMEOUT,
            1_024
        );
        if (resumed.timedOut() || resumed.exitCode() != 0) {
            destroyUnverified(handle, "could not be unpaused: "
                + LOG_REDACTOR.redact(resumed.output().trim()));
        }
    }

    /**
     * Host PID of the container init. {@code docker top} reports host PIDs, so
     * this is the one process that must be ignored. Returns -1 when it cannot
     * be determined; callers fail closed.
     */
    private long initHostPid(SandboxHandle handle) {
        DockerResult inspect = runDocker(
            List.of(config.dockerBinary(), "inspect",
                "-f", "{{.State.Pid}}", handle.id()),
            INSPECT_TIMEOUT,
            1_024
        );
        if (inspect.timedOut() || inspect.exitCode() != 0) {
            log.warn("Sandbox {} init PID could not be read: {}",
                handle.id(), LOG_REDACTOR.redact(inspect.output().trim()));
            return -1;
        }
        try {
            long pid = Long.parseLong(inspect.output().trim());
            return pid > 0 ? pid : -1;
        } catch (NumberFormatException e) {
            log.warn("Sandbox {} init PID was not numeric: {}",
                handle.id(), LOG_REDACTOR.redact(inspect.output().trim()));
            return -1;
        }
    }

    private static boolean usableProcessTable(DockerResult result) {
        return !result.timedOut() && result.exitCode() == 0
            && result.output() != null && !result.output().isBlank()
            && !result.truncated();
    }

    /**
     * Destroy a sandbox whose quiescence could not be verified, then always
     * fail. The container may be gone, but the workspace is a bind mount and
     * may already contain survivor writes, so the exec is unverified and the
     * handle is marked compromised.
     */
    private void destroyUnverified(SandboxHandle handle, String reason) throws IOException {
        log.warn("Sandbox {} {}; destroying it", handle.id(), reason);
        boolean destroyed = false;
        try {
            destroyInternal(handle);
            destroyed = true;
        } catch (IOException e) {
            log.warn("Sandbox {} could not be destroyed after {}: {}; falling back to kill",
                handle.id(), reason, e.getMessage());
        }
        if (!destroyed) {
            stop(handle);
            compromised.add(handle.id());
            if (!containerStopped(handle.id())) {
                throw new IOException("Sandbox " + handle.id()
                    + " could not be stopped after " + reason
                    + "; refusing to continue with a live container");
            }
        } else {
            compromised.add(handle.id());
        }
        throw new IOException("Sandbox " + handle.id() + " " + reason
            + "; the workspace may contain survivor writes, so the exec is unverified");
    }

    /**
     * Stop a sandbox after a cleanup failure and always fail: even a verified
     * stop leaves the workspace tainted.
     */
    private void stopOrFail(SandboxHandle handle, String reason) throws IOException {
        stop(handle);
        compromised.add(handle.id());
        if (!containerStopped(handle.id())) {
            throw new IOException("Sandbox " + handle.id()
                + " could not be stopped after " + reason
                + "; refusing to continue with a live container");
        }
        throw new IOException("Sandbox " + handle.id() + " " + reason
            + "; the workspace may be tainted, so the exec is unverified");
    }

    /**
     * Stop a sandbox whose exec already failed (for example a timeout) and
     * verify that it is no longer running. A successful stop leaves the
     * sandbox in a defined, non-live state; a failure is fatal.
     */
    private void stopVerified(SandboxHandle handle, String reason) throws IOException {
        stop(handle);
        if (!containerStopped(handle.id())) {
            compromised.add(handle.id());
            throw new IOException("Sandbox " + handle.id()
                + " could not be stopped after " + reason
                + "; refusing to continue with a live container");
        }
    }

    /**
     * True when the container is gone or no longer running. Unknown daemon
     * state is treated as running (fail closed).
     */
    private boolean containerStopped(String name) {
        DockerResult inspect = runDocker(
            List.of(config.dockerBinary(), "inspect",
                "-f", "{{.State.Running}}", name),
            INSPECT_TIMEOUT,
            1_024
        );
        String output = inspect.output() == null ? "" : inspect.output().toLowerCase();
        if (inspect.timedOut() || inspect.exitCode() != 0) {
            return output.contains("no such container") || output.contains("no such object");
        }
        return "false".equals(output.trim());
    }

    /**
     * True only when the table actually contains the init host PID row. A
     * header-only (or otherwise incomplete) table cannot prove quiescence.
     */
    static boolean containsInitRow(String output, boolean stateAware, long initPid) {
        if (output == null || output.isBlank()) {
            return false;
        }
        List<String> lines = new ArrayList<>();
        for (String line : output.split("\\R")) {
            if (!line.isBlank()) {
                lines.add(line.trim());
            }
        }
        if (lines.isEmpty()) {
            return false;
        }
        String[] header = lines.get(0).split("\\s+");
        int pidIndex = -1;
        for (int i = 0; i < header.length; i++) {
            if ("PID".equalsIgnoreCase(header[i])) {
                pidIndex = i;
                break;
            }
        }
        int firstDataLine = 1;
        if (pidIndex < 0) {
            if (!stateAware) {
                return false;
            }
            pidIndex = 0;
            firstDataLine = 0;
        }
        for (int i = firstDataLine; i < lines.size(); i++) {
            String[] parts = lines.get(i).split("\\s+");
            if (parts.length > pidIndex && parts[pidIndex].matches("\\d+")
                && Long.parseLong(parts[pidIndex]) == initPid) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parse {@code docker top} output. {@code docker top} reports host PIDs, so
     * the init host PID is the only process that is ignored. When a state
     * column is available, zombies (which cannot fork) are ignored too;
     * without one, every other process counts. Unknown layouts fail closed.
     */
    static List<String> parseSurvivors(String output, boolean stateAware, long initPid) {
        List<String> survivors = new ArrayList<>();
        if (output == null || output.isBlank()) {
            return survivors;
        }
        List<String> lines = new ArrayList<>();
        for (String line : output.split("\\R")) {
            if (!line.isBlank()) {
                lines.add(line.trim());
            }
        }
        if (lines.isEmpty()) {
            return survivors;
        }

        String[] header = lines.get(0).split("\\s+");
        int pidIndex = -1;
        int statIndex = -1;
        for (int i = 0; i < header.length; i++) {
            if ("PID".equalsIgnoreCase(header[i])) {
                pidIndex = i;
            }
            if ("STAT".equalsIgnoreCase(header[i])) {
                statIndex = i;
            }
        }
        if (pidIndex < 0) {
            // Unknown layout: do not claim quiescence on a guess.
            for (String line : lines) {
                for (String token : line.split("\\s+")) {
                    if (!token.matches("\\d+")) {
                        continue;
                    }
                    long pid = Long.parseLong(token);
                    if (pid > 0 && pid != initPid) {
                        survivors.add(line);
                        break;
                    }
                }
            }
            return survivors;
        }

        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i);
            String[] parts = line.split("\\s+");
            if (parts.length <= pidIndex || !parts[pidIndex].matches("\\d+")) {
                continue;
            }
            long pid = Long.parseLong(parts[pidIndex]);
            if (pid <= 0 || pid == initPid) {
                continue;
            }
            if (stateAware && statIndex >= 0 && statIndex < parts.length
                && parts[statIndex].startsWith("Z")) {
                continue;
            }
            survivors.add(line);
        }
        return survivors;
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
        return runDockerStreaming(command, timeout, maxOutputBytes, sandboxId, null);
    }

    private DockerResult runDockerStreaming(
        List<String> command,
        Duration timeout,
        int maxOutputBytes,
        String sandboxId,
        Consumer<String> listener
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
                CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPLACE)
                    .onUnmappableCharacter(CodingErrorAction.REPLACE);
                ByteBuffer carry = ByteBuffer.allocate(4);
                try (InputStream input = running.getInputStream()) {
                    byte[] chunk = new byte[8_192];
                    int read;
                    while ((read = input.read(chunk)) >= 0) {
                        output.write(chunk, 0, read);
                        if (listener != null) {
                            try {
                                ByteBuffer bytes = ByteBuffer.allocate(
                                    carry.position() + read);
                                carry.flip();
                                bytes.put(carry);
                                bytes.put(chunk, 0, read);
                                bytes.flip();
                                CharBuffer chars = CharBuffer.allocate(
                                    (int) (bytes.remaining() * decoder.maxCharsPerByte()) + 1);
                                CoderResult result = decoder.decode(bytes, chars, false);
                                chars.flip();
                                if (chars.hasRemaining()) {
                                    listener.accept(chars.toString());
                                }
                                carry.clear();
                                if (result.isOverflow()) {
                                    carry.put(bytes);
                                } else if (bytes.hasRemaining()) {
                                    carry.put(bytes);
                                }
                            } catch (RuntimeException e) {
                                log.debug("Sandbox streaming listener stopped: {}",
                                    e.getMessage());
                            }
                        }
                    }
                    if (listener != null) {
                        try {
                            ByteBuffer bytes = carry;
                            bytes.flip();
                            CharBuffer chars = CharBuffer.allocate(8);
                            decoder.decode(bytes, chars, true);
                            decoder.flush(chars);
                            chars.flip();
                            if (chars.hasRemaining()) {
                                listener.accept(chars.toString());
                            }
                        } catch (RuntimeException e) {
                            log.debug("Sandbox streaming listener stopped: {}",
                                e.getMessage());
                        }
                    }
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

    private ServiceRuntime startServices(String sandboxName, SandboxSpec spec) throws IOException {
        if (spec.services().isEmpty()) {
            return null;
        }
        String suffix = sandboxName.startsWith("vibecode-sandbox-")
            ? sandboxName.substring("vibecode-sandbox-".length())
            : sandboxName;
        String network = "vibecode-services-" + suffix;
        List<String> networkCommand = new ArrayList<>(List.of(
            config.dockerBinary(), "network", "create",
            "--driver", "bridge", "--internal", "--label", LABEL));
        addOwnerLabel(networkCommand, spec.owner());
        networkCommand.add(network);
        DockerResult created = runDocker(networkCommand, CREATE_TIMEOUT, CONTROL_OUTPUT_BYTES);
        if (created.timedOut() || created.exitCode() != 0) {
            throw new IOException("Could not create service network '" + network + "': "
                + created.output());
        }

        List<String> containers = new ArrayList<>();
        Map<String, String> environment = new LinkedHashMap<>();
        Map<String, String> hosts = new LinkedHashMap<>();
        try {
            for (ServiceSpec service : spec.services()) {
                String container = "vibecode-service-" + suffix + "-" + service.name();
                Map<String, String> serviceEnvironment = new LinkedHashMap<>(service.env());
                String password = service.passwordEnv() == null ? null : randomServicePassword();
                if (password != null) {
                    serviceEnvironment.put(service.passwordEnv(), password);
                }
                Path envFile = writeEnvironmentFile(serviceEnvironment);
                List<String> command = new ArrayList<>(List.of(
                    config.dockerBinary(), "run", "-d", "--name", container,
                    "--label", LABEL
                ));
                addOwnerLabel(command, spec.owner());
                command.addAll(List.of(
                    "--network", network,
                    "--pids-limit", "256",
                    "--memory", "536870912",
                    "--cpus", "1.0",
                    "--security-opt", "no-new-privileges",
                    "--health-cmd", service.healthcheck().command(),
                    "--health-interval", service.healthcheck().intervalSeconds() + "s",
                    "--health-timeout", service.healthcheck().timeoutSeconds() + "s",
                    "--health-retries", String.valueOf(service.healthcheck().retries())
                ));
                if (service.healthcheck().startPeriodSeconds() > 0) {
                    command.add("--health-start-period");
                    command.add(service.healthcheck().startPeriodSeconds() + "s");
                }
                command.add("--env-file");
                command.add(envFile.toString());
                command.add(service.image());
                DockerResult started;
                try {
                    started = runDocker(command, CREATE_TIMEOUT, CONTROL_OUTPUT_BYTES);
                } finally {
                    deleteQuietly(envFile);
                }
                if (started.timedOut() || started.exitCode() != 0) {
                    throw new IOException("Could not start service '" + service.name()
                        + "': " + (started.timedOut() ? "docker run timed out" : started.output()));
                }
                containers.add(container);
                awaitServiceHealthy(container, service.healthcheck());
                DockerResult address = runDocker(
                    List.of(config.dockerBinary(), "inspect", "-f",
                        "{{index .NetworkSettings.Networks \"" + network + "\" \"IPAddress\"}}",
                        container),
                    INSPECT_TIMEOUT,
                    1_024
                );
                String serviceAddress = address.output().trim();
                if (address.exitCode() != 0 || !serviceAddress.matches("[0-9a-fA-F:.]+")) {
                    throw new IOException("Could not determine the address of service '"
                        + service.name() + "': " + address.output());
                }
                hosts.put(service.name(), serviceAddress);
                String url = service.connectionUrl().replace("${host}", service.name());
                if (password != null) {
                    url = url.replace("${password}", password);
                }
                environment.put(service.connectionEnv(), url);
            }
            return new ServiceRuntime(network, containers, environment, hosts);
        } catch (IOException | RuntimeException e) {
            for (String container : containers) {
                runDocker(List.of(config.dockerBinary(), "rm", "-f", "-v", container),
                    CONTROL_TIMEOUT, CONTROL_OUTPUT_BYTES);
            }
            runDocker(List.of(config.dockerBinary(), "network", "rm", network),
                CONTROL_TIMEOUT, CONTROL_OUTPUT_BYTES);
            throw e instanceof IOException io ? io : new IOException(e);
        }
    }

    private void stopServices(String name) {
        ServiceRuntime runtime = services.remove(name);
        if (runtime == null) {
            return;
        }
        for (String container : runtime.containers()) {
            DockerResult removed = runDocker(
                List.of(config.dockerBinary(), "rm", "-f", "-v", container),
                CONTROL_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (!removed.timedOut() && removed.exitCode() == 0) {
                continue;
            }
            String output = removed.output().toLowerCase();
            if (!output.contains("no such container") && !output.contains("no such object")) {
                log.warn("Could not remove service container {}: {}", container,
                    LOG_REDACTOR.redact(removed.output().trim()));
            }
        }
        // stop() keeps the sandbox container, so detach it before removing the
        // network; destroy() already removed the container and this is a no-op.
        runDocker(
            List.of(config.dockerBinary(), "network", "disconnect", "-f",
                runtime.network(), name),
            CONTROL_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        DockerResult network = runDocker(
            List.of(config.dockerBinary(), "network", "rm", runtime.network()),
            CONTROL_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        if (network.exitCode() != 0 && !network.timedOut()) {
            String output = network.output().toLowerCase();
            if (!output.contains("not found") && !output.contains("no such")) {
                log.warn("Could not remove service network {}: {}", runtime.network(),
                    LOG_REDACTOR.redact(network.output().trim()));
            }
        }
    }

    private void awaitServiceHealthy(String container, ServiceSpec.Healthcheck healthcheck)
        throws IOException {
        long timeoutMs = Math.min(300_000L,
            (healthcheck.startPeriodSeconds()
                + (long) healthcheck.intervalSeconds() * healthcheck.retries() + 15L) * 1_000L);
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (System.nanoTime() < deadline) {
            DockerResult state = runDocker(
                List.of(config.dockerBinary(), "inspect", "-f",
                    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
                    container),
                INSPECT_TIMEOUT,
                1_024
            );
            if (state.timedOut() || state.exitCode() != 0) {
                throw new IOException("Could not inspect service '" + container + "': "
                    + state.output());
            }
            String status = state.output().trim().toLowerCase();
            if ("healthy".equals(status)) {
                return;
            }
            if ("unhealthy".equals(status) || "exited".equals(status)
                || "dead".equals(status) || "removing".equals(status)) {
                throw new IOException("Service '" + container + "' is " + status);
            }
            try {
                Thread.sleep(Math.max(1, healthcheck.intervalSeconds()) * 1_000L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while waiting for service '" + container + "'", e);
            }
        }
        throw new IOException("Service '" + container + "' did not become healthy within "
            + timeoutMs / 1_000 + "s");
    }

    private Path writeEnvironmentFile(Map<String, String> environment) throws IOException {
        Path file = Files.createTempFile("vibecode-service-env-", ".env");
        try {
            try {
                Files.setPosixFilePermissions(file,
                    PosixFilePermissions.fromString("rw-------"));
            } catch (UnsupportedOperationException ignored) {
                // Non-POSIX filesystems still get the process umask.
            }
            StringBuilder content = new StringBuilder();
            for (Map.Entry<String, String> entry : environment.entrySet()) {
                content.append(entry.getKey()).append('=').append(entry.getValue()).append('\n');
            }
            Files.writeString(file, content.toString(), StandardCharsets.UTF_8);
            return file;
        } catch (IOException | RuntimeException e) {
            deleteQuietly(file);
            throw e;
        }
    }

    private static void deleteQuietly(Path file) {
        if (file == null) {
            return;
        }
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // Best effort; the file contains only test service configuration.
        }
    }

    private static String randomServicePassword() {
        return (UUID.randomUUID().toString() + UUID.randomUUID())
            .replace("-", "");
    }

    private EgressRuntime startEgress(String sandboxName, SandboxSpec spec) throws IOException {
        String suffix = sandboxName.startsWith("vibecode-sandbox-")
            ? sandboxName.substring("vibecode-sandbox-".length())
            : sandboxName;
        String network = "vibecode-egress-" + suffix;
        String proxy = "vibecode-egress-proxy-" + suffix;
        Path mtlsEnvFile = null;
        try {
            List<String> networkCommand = new ArrayList<>(List.of(
                config.dockerBinary(), "network", "create",
                "--driver", "bridge", "--internal", "--label", LABEL));
            addOwnerLabel(networkCommand, spec.owner());
            networkCommand.add(network);
            DockerResult created = runDocker(
                networkCommand,
                CREATE_TIMEOUT,
                CONTROL_OUTPUT_BYTES
            );
            if (created.timedOut() || created.exitCode() != 0) {
                throw new IOException("Could not create egress network '" + network + "': "
                    + created.output());
            }

            if (spec.egressMtls() != null) {
                mtlsEnvFile = writeMtlsEnvFile(spec.egressMtls());
            }
            List<String> proxyCommand = new ArrayList<>();
            proxyCommand.add(config.dockerBinary());
            proxyCommand.addAll(buildProxyRunArgs(spec, proxy, network, mtlsEnvFile));
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
            if (!spec.egressOriginCaHosts().isEmpty()) {
                // Durable supervisor-side record of the trust decision, even
                // if the proxy container is removed before its logs are read.
                log.info("Egress proxy origin CA trust: hosts={} sha256={}",
                    String.join(",", spec.egressOriginCaHosts()),
                    originCaSha256(spec.egressOriginCaPem()));
            }
            if (spec.egressMtls() != null) {
                log.info("Egress proxy mTLS client certificate: hosts={} sha256={}",
                    String.join(",", spec.egressMtls().hosts()),
                    spec.egressMtls().certSha256());
            }

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
        } finally {
            if (mtlsEnvFile != null) {
                try {
                    Files.deleteIfExists(mtlsEnvFile);
                } catch (IOException e) {
                    log.warn("Could not remove the temporary mTLS environment file: {}",
                        e.getMessage());
                }
            }
        }
    }

    private Path writeMtlsEnvFile(EgressMtlsMaterial material) throws IOException {
        Path file = Files.createTempFile("vibecode-egress-mtls-", ".env");
        try {
            try {
                Files.setPosixFilePermissions(file,
                    PosixFilePermissions.fromString("rw-------"));
            } catch (UnsupportedOperationException ignored) {
                // Non-POSIX filesystems still get the process umask.
            }
            String content = "EGRESS_MTLS_HOSTS=" + String.join(",", material.hosts()) + "\n"
                + "EGRESS_MTLS_CERT_PEM_B64="
                + Base64.getEncoder().encodeToString(
                    material.certPem().getBytes(StandardCharsets.UTF_8)) + "\n"
                + "EGRESS_MTLS_KEY_PEM_B64="
                + Base64.getEncoder().encodeToString(
                    material.keyPem().getBytes(StandardCharsets.UTF_8)) + "\n";
            Files.writeString(file, content, StandardCharsets.UTF_8);
            return file;
        } catch (IOException | RuntimeException e) {
            try {
                Files.deleteIfExists(file);
            } catch (IOException ignored) {
                // Preserve the original write failure.
            }
            throw e;
        }
    }

    /**
     * Install the per-run CA and combined trust bundle into a terminate-mode
     * sandbox. The proxy CA is read with {@code docker exec cat} because
     * {@code docker cp} cannot see a container's tmpfs. The sandbox system
     * bundle is read through a bounded tar stream, and the resulting files are
     * written into the sandbox tmpfs through {@code docker exec -i}.
     */
    private void provisionEgressTrust(
        String sandbox,
        EgressRuntime egress,
        SandboxSpec spec
    ) throws IOException {
        if (egress == null || spec.egressTlsMode() != EgressTlsMode.TERMINATE) {
            return;
        }
        byte[] ca = readContainerFileViaExec(
            egress.proxyName(),
            "/tmp/vibecode-egress-ca/ca.crt",
            64 * 1024,
            COPY_TIMEOUT
        );
        validateCaCertificates(ca, 1);

        String systemPath = "/etc/ssl/certs/ca-certificates.crt";
        ContainerPathState state = containerPathState(sandbox, systemPath);
        byte[] systemBundle = null;
        if (state == ContainerPathState.MISSING) {
            log.warn("Sandbox {} has no system CA bundle; using the per-run CA only",
                sandbox);
        } else if (state == ContainerPathState.FILE) {
            try {
                systemBundle = readContainerFile(
                    sandbox, systemPath, 4 * 1024 * 1024, COPY_TIMEOUT);
            } catch (NoSuchFileException e) {
                throw new IOException(
                    "The system CA bundle disappeared after the pre-check", e);
            }
            validateCaCertificates(systemBundle, Integer.MAX_VALUE);
        } else {
            throw new IOException("The system CA bundle is not a regular file: " + state);
        }

        byte[] combined = systemBundle == null ? ca : concat(systemBundle, ca);
        writeContainerFileViaExec(sandbox, "/tmp/vibecode-egress-ca.crt", ca);
        writeContainerFileViaExec(sandbox, "/tmp/vibecode-ca-bundle.crt", combined);

        Map<String, String> javaEnvironment = provisionJavaTrust(sandbox, ca);
        if (javaEnvironment.isEmpty()) {
            log.info("Sandbox {} has no JDK/keytool; Java/Maven/Gradle will not "
                + "trust the per-run CA", sandbox);
        } else {
            execEnvironments.put(sandbox, javaEnvironment);
            log.info("Installed the per-run Java truststore for sandbox {}", sandbox);
        }
    }

    private Map<String, String> provisionJavaTrust(String sandbox, byte[] ca)
        throws IOException {
        JavaTrustProvisioner.Executor executor = new JavaTrustProvisioner.Executor() {
            @Override
            public JavaTrustProvisioner.Result exec(
                String script,
                Duration timeout,
                int maxOutputBytes
            ) throws IOException {
                DockerResult result = runDocker(
                    List.of(config.dockerBinary(), "exec", sandbox, "/bin/sh", "-c", script),
                    timeout,
                    maxOutputBytes
                );
                return new JavaTrustProvisioner.Result(
                    result.exitCode(), result.output(), result.timedOut());
            }

            @Override
            public void write(String path, byte[] bytes) throws IOException {
                writeContainerFileViaExec(sandbox, path, bytes, COPY_TIMEOUT);
            }
        };
        return JavaTrustProvisioner.provision(executor, ca, COPY_TIMEOUT);
    }

    enum ContainerPathState {
        FILE,
        MISSING,
        BROKEN_SYMLINK,
        NOT_A_FILE,
        UNKNOWN
    }

    ContainerPathState containerPathState(String container, String path)
        throws IOException {
        String script = "p=$1; "
            + "if [ -L \"$p\" ] && [ ! -e \"$p\" ]; then echo BROKEN; "
            + "elif [ ! -e \"$p\" ]; then echo MISSING; "
            + "elif [ ! -f \"$p\" ]; then echo NOTFILE; "
            + "else echo FILE; fi";
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "exec", container, "/bin/sh", "-c",
                script, "sh", path),
            INSPECT_TIMEOUT,
            1_024
        );
        if (result.timedOut() || result.exitCode() != 0) {
            return ContainerPathState.UNKNOWN;
        }
        return switch (result.output().trim()) {
            case "FILE" -> ContainerPathState.FILE;
            case "MISSING" -> ContainerPathState.MISSING;
            case "BROKEN" -> ContainerPathState.BROKEN_SYMLINK;
            case "NOTFILE" -> ContainerPathState.NOT_A_FILE;
            default -> ContainerPathState.UNKNOWN;
        };
    }

    private byte[] readContainerFileViaExec(
        String container,
        String remotePath,
        int maxBytes,
        Duration timeout
    ) throws IOException {
        List<String> command = List.of(
            config.dockerBinary(), "exec", container, "cat", remotePath);
        ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(command));
        builder.redirectErrorStream(false);
        EnvironmentSanitizer.sanitize(builder.environment());
        copyDockerEnvironment(builder.environment());

        BoundedTailBuffer stdout = new BoundedTailBuffer(maxBytes);
        BoundedTailBuffer stderr = new BoundedTailBuffer(8_192);
        Process process;
        try {
            process = builder.start();
        } catch (IOException e) {
            throw new IOException("Could not run docker exec cat for " + remotePath, e);
        }
        Thread outReader = reader(process.getInputStream(), stdout, "sandbox-exec-out");
        Thread errReader = reader(process.getErrorStream(), stderr, "sandbox-exec-err");
        try {
            boolean finished = process.waitFor(
                Math.max(1, timeout.toMillis()), TimeUnit.MILLISECONDS);
            if (!finished) {
                ProcessGroup.kill(process);
                outReader.join(2_000);
                throw new IOException("docker exec cat timed out for " + remotePath);
            }
            outReader.join(2_000);
            errReader.join(1_000);
            if (process.exitValue() != 0) {
                throw new IOException("Could not read " + remotePath + ": "
                    + stderr.text().trim());
            }
            if (stdout.truncated()) {
                throw new IOException("The file at " + remotePath + " exceeds its bound");
            }
            return stdout.text().getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            ProcessGroup.kill(process);
            throw new IOException("Interrupted while reading " + remotePath, e);
        }
    }

    private static Thread reader(
        InputStream input,
        BoundedTailBuffer target,
        String name
    ) {
        Thread thread = new Thread(() -> {
            try (InputStream stream = input) {
                stream.transferTo(target);
            } catch (IOException ignored) {
                // The caller classifies failure from the exit status.
            }
        }, name);
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private byte[] readContainerFile(
        String container,
        String remotePath,
        int maxBytes,
        Duration timeout
    ) throws IOException {
        return transferContainerFile(
            container, remotePath, null, maxBytes, timeout, true);
    }

    /**
     * Stream a container file into {@code target} through the bounded tar
     * reader. Used for artifacts, so the tar stream is the authority for the
     * entry type and size and no artifact bytes are buffered in memory.
     *
     * <p>{@code docker cp} without {@code -L} does not follow the final path
     * component but still resolves intermediate directory symlinks. The
     * pre-copy {@code readlink -f} guard normally rejects those; a racing
     * same-container process can therefore still redirect an intermediate
     * component. Everything reachable that way is inside the sandbox
     * container (the only host mount is {@code /workspace}), so this is a
     * final-component-only no-follow guarantee, not a host-secret boundary.</p>
     */
    private void copyContainerFile(
        String container,
        String remotePath,
        Path target,
        int maxBytes,
        Duration timeout
    ) throws IOException {
        transferContainerFile(container, remotePath, target, maxBytes, timeout, false);
    }

    private byte[] transferContainerFile(
        String container,
        String remotePath,
        Path target,
        int maxBytes,
        Duration timeout,
        boolean followLinks
    ) throws IOException {
        List<String> command = followLinks
            ? List.of(config.dockerBinary(), "cp", "-L", container + ":" + remotePath, "-")
            : List.of(config.dockerBinary(), "cp", container + ":" + remotePath, "-");
        ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(command));
        builder.redirectErrorStream(false);
        EnvironmentSanitizer.sanitize(builder.environment());
        copyDockerEnvironment(builder.environment());

        BoundedTailBuffer stderr = new BoundedTailBuffer(8_192);
        Process process;
        try {
            process = builder.start();
        } catch (IOException e) {
            throw new IOException("Could not run docker cp for " + remotePath, e);
        }
        Thread errorReader = new Thread(() -> {
            try (InputStream input = process.getErrorStream()) {
                input.transferTo(stderr);
            } catch (IOException ignored) {
                // The failure is classified from the exit status and stdout.
            }
        }, "sandbox-docker-cp-error");
        errorReader.setDaemon(true);
        errorReader.start();

        AtomicReference<byte[]> bytes = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        CountDownLatch outputDone = new CountDownLatch(1);
        int maxTarBytes = maxBytes > Integer.MAX_VALUE - 8_192
            ? Integer.MAX_VALUE : maxBytes + 8_192;
        Thread outputReader = new Thread(() -> {
            try {
                if (target == null) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    BoundedTarFileReader.copy(
                        process.getInputStream(), buffer, maxBytes, maxTarBytes);
                    bytes.set(buffer.toByteArray());
                } else {
                    try (OutputStream output = Files.newOutputStream(target)) {
                        BoundedTarFileReader.copy(
                            process.getInputStream(), output, maxBytes, maxTarBytes);
                    }
                }
            } catch (Throwable error) {
                failure.set(error);
                ProcessGroup.kill(process);
            } finally {
                outputDone.countDown();
            }
        }, "sandbox-docker-cp-output");
        outputReader.setDaemon(true);
        outputReader.start();

        try {
            boolean finished = process.waitFor(
                Math.max(1, timeout.toMillis()), TimeUnit.MILLISECONDS);
            if (!finished) {
                ProcessGroup.kill(process);
                outputReader.join(2_000);
                throw new IOException("docker cp timed out for " + remotePath);
            }
            outputReader.join(2_000);
            errorReader.join(1_000);
            String errorOutput = stderr.text().trim();
            Throwable readerFailure = awaitReaderFailure(
                outputDone, failure::get, () -> ProcessGroup.kill(process), remotePath);
            if (readerFailure != null) {
                if (isMissingFile(errorOutput)) {
                    throw new NoSuchFileException(remotePath);
                }
                throw new IOException(
                    "Could not read " + remotePath + ": " + errorOutput, readerFailure);
            }
            if (process.exitValue() != 0) {
                if (isMissingFile(errorOutput)) {
                    throw new NoSuchFileException(remotePath);
                }
                throw new IOException("Could not read " + remotePath + ": " + errorOutput);
            }
            if (target == null && bytes.get() == null) {
                throw new IOException("Could not read " + remotePath + ": empty archive");
            }
            return target == null ? bytes.get() : null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            ProcessGroup.kill(process);
            throw new IOException("Interrupted while reading " + remotePath, e);
        }
    }

    /**
     * Read the tar reader's failure only after it has signalled completion.
     *
     * <p>Checking the completion latch first provides the happens-before edge
     * from the reader thread. Reading the failure first would allow a reader
     * that fails just after the join window to be observed as a stale null and
     * a partial temp file to be treated as a success.</p>
     *
     * @param onUnfinished invoked when the reader is still running
     */
    static Throwable awaitReaderFailure(
        CountDownLatch done,
        Supplier<Throwable> failure,
        Runnable onUnfinished,
        String remotePath
    ) throws IOException, InterruptedException {
        if (!done.await(0, TimeUnit.MILLISECONDS)) {
            onUnfinished.run();
            throw new IOException(
                "docker cp output reader did not finish for " + remotePath);
        }
        return failure.get();
    }

    private static boolean isMissingFile(String output) {
        String lower = output == null ? "" : output.toLowerCase();
        return lower.contains("could not find the file")
            || lower.contains("no such file")
            || lower.contains("not found");
    }

    private static void validateCaCertificates(byte[] bytes, int maxCertificates)
        throws IOException {
        if (bytes == null || bytes.length == 0) {
            throw new IOException("CA bundle is empty");
        }
        try {
            CertificateFactory factory = CertificateFactory.getInstance("X.509");
            Collection<? extends Certificate> certificates =
                factory.generateCertificates(new ByteArrayInputStream(bytes));
            if (certificates.isEmpty()) {
                throw new IOException("CA bundle contains no X.509 certificates");
            }
            if (certificates.size() > maxCertificates) {
                throw new IOException("CA bundle contains too many certificates");
            }
            for (Certificate certificate : certificates) {
                X509Certificate x509 = (X509Certificate) certificate;
                if (x509.getBasicConstraints() < 0 && x509.getVersion() != 1) {
                    throw new IOException("CA bundle contains a non-CA certificate");
                }
            }
        } catch (java.security.cert.CertificateException e) {
            throw new IOException("CA bundle is not valid X.509", e);
        }
    }

    private static byte[] concat(byte[] first, byte[] second) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(
            first.length + second.length + 1);
        out.writeBytes(first);
        out.write('\n');
        out.writeBytes(second);
        return out.toByteArray();
    }

    private void writeContainerFileViaExec(
        String container,
        String remotePath,
        byte[] bytes
    ) throws IOException {
        writeContainerFileViaExec(container, remotePath, bytes, COPY_TIMEOUT);
    }

    /**
     * Write a validated file into the sandbox tmpfs through {@code docker exec
     * -i}. Stdin comes from a temp file, so a shell that ignores stdin cannot
     * block the supervisor's caller thread; the process is still bounded by
     * the supplied timeout.
     */
    void writeContainerFileViaExec(
        String container,
        String remotePath,
        byte[] bytes,
        Duration timeout
    ) throws IOException {
        String script = "cat > " + shellQuote(remotePath)
            + " && chmod 0444 " + shellQuote(remotePath);
        List<String> command = List.of(
            config.dockerBinary(), "exec", "-i", container, "/bin/sh", "-c", script);
        Path temp = Files.createTempFile("vibecode-egress-write-", ".pem");
        Process process = null;
        BoundedTailBuffer stderr = new BoundedTailBuffer(8_192);
        try {
            Files.write(temp, bytes);
            ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(command));
            builder.redirectErrorStream(false);
            builder.redirectInput(temp.toFile());
            builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
            EnvironmentSanitizer.sanitize(builder.environment());
            copyDockerEnvironment(builder.environment());
            process = builder.start();
            Thread errReader = reader(process.getErrorStream(), stderr, "sandbox-exec-err");

            boolean finished = process.waitFor(
                Math.max(1, timeout.toMillis()), TimeUnit.MILLISECONDS);
            if (!finished) {
                ProcessGroup.kill(process);
                errReader.join(2_000);
                throw new IOException("docker exec write timed out for " + remotePath);
            }
            errReader.join(1_000);
            if (process.exitValue() != 0) {
                throw new IOException("Could not write " + remotePath
                    + " into the sandbox: " + stderr.text().trim());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                ProcessGroup.kill(process);
            }
            throw new IOException("Interrupted while writing " + remotePath, e);
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    private static void addOwnerLabel(List<String> args, String owner) {
        if (owner != null && !owner.isBlank()) {
            args.add("--label");
            args.add("vibecode.sandbox.owner=" + owner);
        }
    }

    /**
     * Remove containers, proxies and networks left by a previous agent process
     * with the same owner. A pool agent also sweeps resources owned by a
     * replaced pool agent when no running agent container carries that owner
     * label. Called once at startup before any new sandbox exists; a failure is
     * logged but does not block startup.
     */
    public void reapOrphans() {
        String owner = config.owner();
        if (owner == null || owner.isBlank()) {
            return;
        }
        try {
            String filter = "label=vibecode.sandbox.owner=" + owner;
            reap("containers",
                List.of(config.dockerBinary(), "ps", "-aq", "--filter", filter),
                List.of(config.dockerBinary(), "rm", "-f"));
            reap("networks",
                List.of(config.dockerBinary(), "network", "ls", "-q", "--filter", filter),
                List.of(config.dockerBinary(), "network", "rm"));
            if (owner.startsWith("pool-") && daemonMatchesForStaleSweep()) {
                reapStalePoolResources(owner);
            }
        } catch (RuntimeException e) {
            log.warn("Could not reap orphaned sandbox resources: {}",
                LOG_REDACTOR.redact(e.toString()));
        }
    }

    /**
     * The agent-container owner label is created by the API client, while the
     * stale sweep runs through the agent's Docker client. Do not guess when
     * the two clients may point at different daemons; skip the sweep unless
     * both report the same daemon ID.
     */
    private boolean daemonMatchesForStaleSweep() {
        if (!config.poolAgent() || config.daemonId() == null
            || config.daemonId().isBlank()) {
            log.warn("Skipping stale pool sweep: SANDBOX_DAEMON_ID is not configured");
            return false;
        }
        DockerResult info = runDocker(
            List.of(config.dockerBinary(), "info", "--format", "{{.ID}}"),
            INSPECT_TIMEOUT,
            1_024
        );
        if (info.timedOut() || info.exitCode() != 0) {
            log.warn("Could not read the agent Docker daemon ID; "
                + "skipping the stale pool sweep: {}",
                LOG_REDACTOR.redact(info.output()));
            return false;
        }
        String actual = info.output().trim();
        if (!config.daemonId().equals(actual)) {
            log.warn("Agent Docker daemon {} does not match the API daemon {}; "
                + "skipping the stale pool sweep", actual, config.daemonId());
            return false;
        }
        return true;
    }

    private void reapStalePoolResources(String currentOwner) {
        Map<String, List<String>> containers = listManagedResources("containers",
            List.of(config.dockerBinary(), "ps", "-a",
                "--filter", "label=" + LABEL,
                "--format", "{{.ID}} {{.Label \"vibecode.sandbox.owner\"}}"));
        Map<String, List<String>> networks = listManagedResources("networks",
            List.of(config.dockerBinary(), "network", "ls",
                "--filter", "label=" + LABEL,
                "--format", "{{.ID}} {{.Label \"vibecode.sandbox.owner\"}}"));

        Set<String> owners = new LinkedHashSet<>();
        owners.addAll(containers.keySet());
        owners.addAll(networks.keySet());
        for (String owner : owners) {
            if (owner.equals(currentOwner) || !owner.startsWith("pool-")) {
                continue;
            }
            if (agentOwnerLive(owner)) {
                continue;
            }
            List<String> containerIds = containers.getOrDefault(owner, List.of());
            for (String id : containerIds) {
                removeResource("containers", id,
                    List.of(config.dockerBinary(), "rm", "-f"));
            }
            List<String> networkIds = networks.getOrDefault(owner, List.of());
            for (String id : networkIds) {
                removeResource("networks", id,
                    List.of(config.dockerBinary(), "network", "rm"));
            }
            if (!containerIds.isEmpty() || !networkIds.isEmpty()) {
                log.info("Reaped stale pool sandbox resources for owner {} "
                    + "({} container(s), {} network(s))",
                    owner, containerIds.size(), networkIds.size());
            }
        }
    }

    private Map<String, List<String>> listManagedResources(
        String kind,
        List<String> command
    ) {
        DockerResult listed = runDocker(command, INSPECT_TIMEOUT, 256 * 1024);
        if (listed.timedOut() || listed.exitCode() != 0) {
            log.warn("Could not list managed sandbox {} for a stale sweep: {}",
                kind, LOG_REDACTOR.redact(listed.output()));
            return Map.of();
        }
        if (listed.truncated()) {
            log.warn("Managed sandbox {} listing was truncated; remaining resources "
                + "will be reaped on the next start", kind);
        }
        Map<String, List<String>> byOwner = new LinkedHashMap<>();
        for (String line : listed.output().split("\r?\n")) {
            String[] parts = line.trim().split("\\s+", 2);
            if (parts.length < 2) {
                continue;
            }
            String id = parts[0];
            String owner = parts[1].trim();
            if (!id.matches("[a-fA-F0-9]{12,64}") || owner.isBlank()
                || !owner.startsWith("pool-")) {
                continue;
            }
            byOwner.computeIfAbsent(owner, ignored -> new ArrayList<>()).add(id);
        }
        return byOwner;
    }

    private boolean agentOwnerLive(String owner) {
        DockerResult result = runDocker(
            List.of(config.dockerBinary(), "ps", "-aq",
                "--filter", "label=vibecode.agent.owner=" + owner),
            INSPECT_TIMEOUT,
            CONTROL_OUTPUT_BYTES
        );
        if (result.timedOut() || result.exitCode() != 0) {
            log.warn("Could not check whether pool owner {} is live; "
                + "skipping its stale resources", owner);
            return true;
        }
        return !result.output().isBlank();
    }

    private void removeResource(String kind, String id, List<String> removePrefix) {
        List<String> command = new ArrayList<>(removePrefix);
        command.add(id);
        DockerResult removed = runDocker(command, CONTROL_TIMEOUT, CONTROL_OUTPUT_BYTES);
        if (removed.timedOut() || removed.exitCode() != 0) {
            log.warn("Could not reap stale sandbox {} {}: {}",
                kind, id, LOG_REDACTOR.redact(removed.output()));
        } else {
            log.info("Reaped stale sandbox {} {}", kind, id);
        }
    }

    private void reap(String kind, List<String> listCommand, List<String> removePrefix) {
        try {
            DockerResult listed = runDocker(listCommand, INSPECT_TIMEOUT, 256 * 1024);
            if (listed.timedOut() || listed.exitCode() != 0) {
                log.warn("Could not list orphaned sandbox {} for reaping: {}",
                    kind, LOG_REDACTOR.redact(listed.output()));
                return;
            }
            if (listed.truncated()) {
                log.warn("Orphaned sandbox {} listing was truncated; remaining IDs "
                    + "will be reaped on the next start", kind);
            }
            for (String id : listed.output().split("\\s+")) {
                if (!id.matches("[a-fA-F0-9]{12,64}")) {
                    continue;
                }
                List<String> command = new ArrayList<>(removePrefix);
                command.add(id);
                DockerResult removed = runDocker(command, CONTROL_TIMEOUT, CONTROL_OUTPUT_BYTES);
                if (removed.timedOut() || removed.exitCode() != 0) {
                    log.warn("Could not reap orphaned sandbox {} {}: {}",
                        kind, id, LOG_REDACTOR.redact(removed.output()));
                } else {
                    log.info("Reaped orphaned sandbox {} {}", kind, id);
                }
            }
        } catch (RuntimeException e) {
            log.warn("Could not reap orphaned sandbox {}: {}", kind,
                LOG_REDACTOR.redact(e.toString()));
        }
    }

    /** Build the hardened proxy container arguments. Package-visible for tests. */
    static List<String> buildProxyRunArgs(SandboxSpec spec, String proxyName, String network) {
        return buildProxyRunArgs(spec, proxyName, network, null);
    }

    static List<String> buildProxyRunArgs(
        SandboxSpec spec,
        String proxyName,
        String network,
        Path mtlsEnvFile
    ) {
        List<String> args = new ArrayList<>();
        args.add("run");
        args.add("-d");
        args.add("--name");
        args.add(proxyName);
        args.add("--label");
        args.add(LABEL);
        addOwnerLabel(args, spec.owner());
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
        args.add("-e");
        args.add("EGRESS_TUNNEL_PROBE_TIMEOUT_MS=" + spec.egressProbeTimeoutMs());
        args.add("-e");
        args.add("EGRESS_TLS_MODE=" + spec.egressTlsMode().value());
        // The extra origin trust is scoped to these allowlisted hosts. Always
        // clear the variables so a proxy image cannot inherit a trust override.
        args.add("-e");
        args.add("EGRESS_ORIGIN_CA_HOSTS=" + String.join(",", spec.egressOriginCaHosts()));
        args.add("-e");
        args.add("EGRESS_ORIGIN_CA_PEM_B64="
            + Base64.getEncoder().encodeToString(
                spec.egressOriginCaPem().getBytes(StandardCharsets.UTF_8)));
        // The client key is written to a 0600 env-file instead of argv. When
        // no mTLS material is attached, explicitly clear inherited values.
        if (mtlsEnvFile != null) {
            args.add("--env-file");
            args.add(mtlsEnvFile.toString());
        } else {
            args.add("-e");
            args.add("EGRESS_MTLS_HOSTS=");
            args.add("-e");
            args.add("EGRESS_MTLS_CERT_PEM_B64=");
            args.add("-e");
            args.add("EGRESS_MTLS_KEY_PEM_B64=");
        }
        // Never inherit a test seam from the proxy image. The resolver override
        // is only honored when EGRESS_TEST_MODE=1, which the supervisor clears.
        args.add("-e");
        args.add("EGRESS_TEST_MODE=0");
        args.add("-e");
        args.add("EGRESS_TEST_RESOLVE_IP=");
        args.add("-e");
        args.add("EGRESS_TEST_ALLOW_LOOPBACK=0");
        args.add("-e");
        args.add("EGRESS_TEST_CONNECT_PORT=0");
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

    /** Stable audit fingerprint of the canonical origin CA bundle. */
    static String originCaSha256(String pem) {
        try {
            return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256")
                    .digest(pem.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
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

    void stopEgress(String network, String proxyName) {
        // Surface denials and the origin-CA audit trail before the container is
        // removed. The proxy logs one JSON line per decision/audit entry.
        DockerResult logs = runDocker(
            List.of(config.dockerBinary(), "logs", "--tail",
                String.valueOf(PROXY_LOG_TAIL), proxyName),
            CONTROL_TIMEOUT,
            PROXY_LOG_OUTPUT_BYTES
        );
        int denialsForwarded = 0;
        int denialsSuppressed = 0;
        for (String line : logs.output().split("\n")) {
            String trimmed = line.trim();
            if (trimmed.contains("\"decision\":\"deny\"")) {
                if (denialsForwarded < PROXY_DENIAL_WARN_LIMIT) {
                    log.warn("Sandbox egress denied: {}", trimmed);
                    denialsForwarded++;
                } else {
                    denialsSuppressed++;
                }
            } else if (trimmed.contains("\"message\":\"egress origin CA")
                || trimmed.contains("\"message\": \"egress origin CA")
                || trimmed.contains("\"message\":\"egress mTLS")
                || trimmed.contains("\"message\": \"egress mTLS")) {
                log.info("Sandbox egress audit: {}", trimmed);
            }
        }
        if (denialsSuppressed > 0) {
            log.warn("Sandbox egress denial summary: {} line(s) suppressed; {} forwarded",
                denialsSuppressed, denialsForwarded);
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
        return buildCreateArgs(spec, name, egress, null);
    }

    static List<String> buildCreateArgs(
        SandboxSpec spec,
        String name,
        EgressRuntime egress,
        ServiceRuntime serviceRuntime
    ) {
        return buildCreateArgs(spec, name, egress, serviceRuntime, null);
    }

    static List<String> buildCreateArgs(
        SandboxSpec spec,
        String name,
        EgressRuntime egress,
        ServiceRuntime serviceRuntime,
        Path serviceEnvFile
    ) {
        List<String> args = new ArrayList<>();
        args.add("run");
        args.add("-d");
        args.add("--name");
        args.add(name);
        args.add("--label");
        args.add(LABEL);
        addOwnerLabel(args, spec.owner());

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

        // No --init: PID 1 must be a single childless process so the frozen
        // quiescence check can distinguish it from descendants. The shell
        // execs into `sleep`, which stays alive without spawning children;
        // `docker exec` still works. --pids-limit and the sweep bound
        // runaway children.
        // Network is default-deny unless an egress allowlist is configured; in
        // that case the sandbox joins only the proxy's internal network and
        // resolves nothing: external DNS would be an untracked exfiltration
        // channel. The proxy is addressed by IP and also pinned in /etc/hosts.
        args.add("--network");
        args.add(serviceRuntime != null
            ? serviceRuntime.network()
            : (egress == null ? "none" : egress.network()));
        if (serviceRuntime != null) {
            for (Map.Entry<String, String> host : serviceRuntime.hosts().entrySet()) {
                args.add("--add-host");
                args.add(host.getKey() + ":" + host.getValue());
            }
        }
        if (egress != null) {
            args.add("--dns");
            args.add("127.0.0.1");
            args.add("--add-host");
            String pinned = egress.proxyAddress().contains(":")
                ? "[" + egress.proxyAddress() + "]"
                : egress.proxyAddress();
            args.add(egress.proxyName() + ":" + pinned);
        }

        if (serviceEnvFile != null) {
            args.add("--env-file");
            args.add(serviceEnvFile.toString());
        }
        for (Map.Entry<String, String> entry : containerEnvironment(spec, egress,
                serviceEnvFile == null && serviceRuntime != null
                    ? serviceRuntime.environment()
                    : Map.of()).entrySet()) {
            args.add("-e");
            args.add(entry.getKey() + "=" + entry.getValue());
        }

        // A hostile process can write to /proc/1/fd/1, so bound the sandbox
        // container logs just like the proxy logs.
        args.add("--log-opt");
        args.add("max-size=1m");
        args.add("--log-opt");
        args.add("max-file=1");

        args.add("--entrypoint");
        args.add("/bin/sh");
        args.add(spec.image());
        args.add("-c");
        // Use a numeric duration so BusyBox and GNU sleep both accept it.
        args.add("exec sleep 2147483647");
        return args;
    }

    /**
     * Per-handle trust environment (currently the Java truststore) is applied
     * after the caller's env so a command cannot accidentally bypass it.
     */
    static Map<String, String> mergeExecEnvironment(
        Map<String, String> base,
        Map<String, String> requested
    ) {
        if ((base == null || base.isEmpty()) && (requested == null || requested.isEmpty())) {
            return Map.of();
        }
        Map<String, String> merged = new LinkedHashMap<>();
        if (requested != null) {
            merged.putAll(requested);
        }
        if (base != null) {
            for (Map.Entry<String, String> entry : base.entrySet()) {
                String name = entry.getKey();
                String value = entry.getValue();
                if ("JAVA_TOOL_OPTIONS".equals(name)) {
                    // Preserve caller JVM options and append the truststore
                    // last, so a caller-provided conflicting trustStore cannot
                    // win over the per-run CA.
                    merged.merge(name, value, (caller, trust) ->
                        caller == null || caller.isBlank()
                            ? trust
                            : caller + " " + trust);
                } else {
                    merged.put(name, value);
                }
            }
        }
        return Map.copyOf(merged);
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
        return containerEnvironment(spec, egress, Map.of());
    }

    static Map<String, String> containerEnvironment(
        SandboxSpec spec,
        EgressRuntime egress,
        Map<String, String> serviceEnvironment
    ) {
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
            if (spec.egressTlsMode() == EgressTlsMode.TERMINATE) {
                String ca = "/tmp/vibecode-egress-ca.crt";
                String bundle = "/tmp/vibecode-ca-bundle.crt";
                env.putIfAbsent("NODE_EXTRA_CA_CERTS", ca);
                env.putIfAbsent("npm_config_cafile", bundle);
                env.putIfAbsent("SSL_CERT_FILE", bundle);
                env.putIfAbsent("GIT_SSL_CAINFO", bundle);
                env.putIfAbsent("CURL_CA_BUNDLE", bundle);
                env.putIfAbsent("PIP_CERT", bundle);
                env.putIfAbsent("REQUESTS_CA_BUNDLE", bundle);
                env.putIfAbsent("CARGO_HTTP_CAINFO", bundle);
            }
        }
        SandboxSecurity.validateEnv(env, "sandbox environment");
        if (serviceEnvironment != null && !serviceEnvironment.isEmpty()) {
            // Generated service connection values may contain a per-run test
            // password. They are trusted supervisor output, never profile env.
            env.putAll(serviceEnvironment);
        }
        return env;
    }

    private record DockerResult(int exitCode, String output, boolean timedOut, boolean truncated) {
    }
}
