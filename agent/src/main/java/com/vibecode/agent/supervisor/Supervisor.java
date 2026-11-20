package com.vibecode.agent.supervisor;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Reconciles declared runtime slots ({@link RuntimeConfig}) against the child
 * JVMs actually running on this host.
 *
 * <p>Each child is identified by a deterministic name ({@code <section>-<i>})
 * and a JSON PID file in a single directory:</p>
 *
 * <pre>{@code
 * {"pid":1234,"name":"workers-1","specHash":"…","startedAt":"2026-11-20T10:00:00Z"}
 * }</pre>
 *
 * <p>{@link #reconcile()} spawns missing children, adopts live children whose
 * spec hash still matches, drains changed or removed children (SIGTERM, a
 * bounded wait, then SIGKILL) and deletes stale PID files. Applying the same
 * declarations twice performs no work. A supervisor crash leaves the children
 * alive because PID files are written before reconcile returns; the next
 * supervisor adopts them on boot.</p>
 *
 * <p>No secret is written to the config, PID files or process argv. Runtime
 * credentials are delivered over the authenticated node channel.</p>
 */
public final class Supervisor implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(Supervisor.class);

    /** Default graceful-stop timeout before a child is killed. */
    public static final Duration DEFAULT_STOP_TIMEOUT = Duration.ofSeconds(10);

    /** Default reconcile interval for {@link #start()}. */
    public static final Duration DEFAULT_POLL_INTERVAL = Duration.ofSeconds(2);

    private static final Duration FORCE_KILL_TIMEOUT = Duration.ofSeconds(2);
    private static final ObjectMapper MAPPER = new ObjectMapper()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    private static final String DEFAULT_JAR = "/app/agent.jar";
    private static final String MAIN_CLASS = "com.vibecode.agent.AgentApp";

    private final Path pidDir;
    private final int heapMb;
    private final ChildLauncher launcher;
    private volatile Map<String, Long> runtimeIds;
    private volatile java.util.Set<String> suspendedSections = java.util.Set.of();
    private final Duration stopTimeout;
    private final Duration pollInterval;
    private final Object lock = new Object();
    private final Map<String, TrackedChild> tracked = new LinkedHashMap<>();

    private volatile RuntimeConfig config;
    private volatile boolean closed;
    private Thread loopThread;

    /**
     * Create a supervisor and immediately sweep the PID directory.
     *
     * @param pidDir  directory holding {@code <child>.pid} files
     * @param config  declared runtimes
     * @param heapMb  per-child JVM heap limit in MiB
     * @param launcher child launcher (the default launcher starts the agent JAR)
     */
    public Supervisor(Path pidDir, RuntimeConfig config, int heapMb, ChildLauncher launcher) {
        this(pidDir, config, heapMb, launcher, Map.of(),
            DEFAULT_STOP_TIMEOUT, DEFAULT_POLL_INTERVAL);
    }

    /**
     * Create a supervisor with explicit runtime ids, stop timeout and poll
     * interval. Runtime ids are optional and normally resolved from the backend
     * node config.
     */
    public Supervisor(
        Path pidDir,
        RuntimeConfig config,
        int heapMb,
        ChildLauncher launcher,
        Map<String, Long> runtimeIds,
        Duration stopTimeout,
        Duration pollInterval
    ) {
        this.pidDir = Objects.requireNonNull(pidDir, "pidDir").toAbsolutePath().normalize();
        this.config = Objects.requireNonNull(config, "config");
        this.heapMb = heapMb;
        this.launcher = Objects.requireNonNull(launcher, "launcher");
        this.runtimeIds = runtimeIds == null ? Map.of() : Map.copyOf(runtimeIds);
        this.stopTimeout = Objects.requireNonNull(stopTimeout, "stopTimeout");
        this.pollInterval = Objects.requireNonNull(pollInterval, "pollInterval");
        if (heapMb <= 0) {
            throw new IllegalArgumentException("heapMb must be positive");
        }
        if (stopTimeout.isNegative() || stopTimeout.isZero()) {
            throw new IllegalArgumentException("stopTimeout must be positive");
        }
        if (pollInterval.isNegative() || pollInterval.isZero()) {
            throw new IllegalArgumentException("pollInterval must be positive");
        }
        try {
            Files.createDirectories(this.pidDir);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create supervisor PID directory " + this.pidDir, e);
        }
        synchronized (lock) {
            sweep(this.config.expandedSlots());
        }
    }

    /** Reconcile against the current declarations. */
    public void reconcile() {
        reconcile(config);
    }

    /**
     * Reconcile against a new declaration set. The new set becomes the current
     * configuration, so a later {@link #reconcile()} uses it.
     */
    public void reconcile(RuntimeConfig desired) {
        Objects.requireNonNull(desired, "desired");
        synchronized (lock) {
            ensureOpen();
            this.config = desired;
            List<RuntimeConfig.RuntimeSlot> slots = activeSlots(desired);
            Map<String, RuntimeConfig.RuntimeSlot> desiredByName = byName(slots);

            sweep(slots);

            for (TrackedChild child : new ArrayList<>(tracked.values())) {
                RuntimeConfig.RuntimeSlot want = desiredByName.get(child.name);
                boolean stillWanted = want != null
                    && want.specHash().equals(child.specHash)
                    && child.process.isAlive();
                if (!stillWanted) {
                    log.info("Draining runtime child {} (pid {})", child.name, child.process.pid());
                    stopTracked(child);
                }
            }

            for (RuntimeConfig.RuntimeSlot slot : slots) {
                TrackedChild existing = tracked.get(slot.name());
                if (existing != null && existing.process.isAlive()
                        && existing.specHash.equals(slot.specHash())) {
                    continue;
                }
                if (existing != null) {
                    stopTracked(existing);
                }
                spawn(slot);
            }
        }
    }

    /** Reconcile in a loop until {@link #close()} or thread interruption. */
    public void runLoop() {
        while (!closed) {
            try {
                reconcile();
            } catch (RuntimeException e) {
                log.warn("Supervisor reconcile failed: {}", e.getMessage());
            }
            try {
                Thread.sleep(pollInterval.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** Start the periodic reconcile loop in a daemon thread. */
    public void start() {
        synchronized (lock) {
            ensureOpen();
            if (loopThread != null && loopThread.isAlive()) {
                return;
            }
            loopThread = new Thread(this::runLoop, "supervisor-reconcile");
            loopThread.setDaemon(true);
            loopThread.start();
        }
    }

    /** Snapshot of currently tracked children, including their live state. */
    public List<ChildState> snapshot() {
        synchronized (lock) {
            List<ChildState> states = new ArrayList<>(tracked.size());
            for (TrackedChild child : tracked.values()) {
                states.add(new ChildState(
                    child.name,
                    child.process.pid(),
                    child.specHash,
                    child.slot.role().wireName(),
                    child.slot.modelRef(),
                    child.slot.effort() == null ? null : child.slot.effort().wireName(),
                    child.slot.project(),
                    child.process.isAlive()));
            }
            return List.copyOf(states);
        }
    }

    /** Alias for {@link #snapshot()} used by tests and health endpoints. */
    public List<ChildState> trackedChildren() {
        return snapshot();
    }

    /**
     * Suspend or resume whole sections after an admin drain/stop. Suspended
     * sections are stopped and not spawned until the server reports them
     * running/pending again.
     */
    public void updateSuspendedSections(java.util.Set<String> sections) {
        synchronized (lock) {
            this.suspendedSections = sections == null ? java.util.Set.of() : java.util.Set.copyOf(sections);
        }
    }

    private List<RuntimeConfig.RuntimeSlot> activeSlots(RuntimeConfig desired) {
        java.util.Set<String> suspended = new java.util.LinkedHashSet<>(suspendedSections);
        suspended.addAll(sectionsWithStopMarkers());
        if (suspended.isEmpty()) {
            return desired.expandedSlots();
        }
        return desired.expandedSlots().stream()
            .filter(slot -> !suspended.contains(slot.runtimeName()))
            .toList();
    }

    /** A child writes this marker when its runtime is permanently denied. */
    public void clearStopMarker(String sectionName) {
        try {
            Files.deleteIfExists(stopMarkerPath(sectionName));
        } catch (IOException e) {
            log.debug("Could not clear stop marker for {}: {}", sectionName, e.getMessage());
        }
    }

    private Path stopMarkerPath(String sectionName) {
        return pidDir.resolve(sectionName + ".stop");
    }

    private java.util.Set<String> sectionsWithStopMarkers() {
        java.util.Set<String> sections = new java.util.LinkedHashSet<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(pidDir, "*.stop")) {
            for (Path file : stream) {
                String name = file.getFileName().toString();
                sections.add(name.substring(0, name.length() - ".stop".length()));
            }
        } catch (IOException e) {
            log.debug("Could not list supervisor stop markers: {}", e.getMessage());
        }
        return sections;
    }

    /** Snapshot of the currently suspended sections. */
    public java.util.Set<String> suspendedSectionsSnapshot() {
        return suspendedSections;
    }

    /** Snapshot of section-name → runtime-id mappings. */
    public Map<String, Long> runtimeIdsSnapshot() {
        return runtimeIds;
    }

    /** Replace the section/runtime id map after a successful re-declaration. */
    public void updateRuntimeIds(Map<String, Long> ids) {
        synchronized (lock) {
            this.runtimeIds = ids == null ? Map.of() : Map.copyOf(ids);
        }
    }

    /** Stop every managed child and end the periodic loop. Idempotent. */
    @Override
    public void close() {
        Thread loop;
        synchronized (lock) {
            if (closed) {
                return;
            }
            closed = true;
            loop = loopThread;
            for (TrackedChild child : new ArrayList<>(tracked.values())) {
                stopTracked(child);
            }
        }
        if (loop != null && loop != Thread.currentThread()) {
            loop.interrupt();
        }
    }

    // ---------------------------------------------------------------------
    // Sweep / reconcile internals
    // ---------------------------------------------------------------------

    private void sweep(List<RuntimeConfig.RuntimeSlot> slots) {
        Map<String, RuntimeConfig.RuntimeSlot> desired = byName(slots);
        for (Path pidFile : listPidFiles()) {
            String stem = pidFile.getFileName().toString();
            stem = stem.substring(0, stem.length() - ".pid".length());
            PidRecord record = readPidRecord(pidFile);
            if (record == null || !stem.equals(record.name())) {
                log.warn("Ignoring malformed supervisor PID file {}", pidFile.getFileName());
                deleteQuietly(pidFile);
                continue;
            }

            TrackedChild existing = tracked.get(record.name());
            if (existing != null) {
                if (existing.process.isAlive()) {
                    continue;
                }
                tracked.remove(record.name());
            }

            Optional<ProcessHandle> handle = ProcessHandle.of(record.pid());
            if (handle.isEmpty() || !handle.get().isAlive()) {
                log.debug("Removing stale PID file for {} (pid {})", record.name(), record.pid());
                deleteQuietly(pidFile);
                continue;
            }

            RuntimeConfig.RuntimeSlot want = desired.get(record.name());
            if (want != null && want.specHash().equals(record.specHash())) {
                if (pidReused(record, handle.get())) {
                    log.warn("PID file {} refers to a process started at a different time; "
                        + "leaving it untouched", pidFile.getFileName());
                    deleteQuietly(pidFile);
                    continue;
                }
                adopt(record, want, handle.get());
            } else {
                log.info("Stopping unmanaged runtime child {} (pid {})", record.name(), record.pid());
                terminate(new HandleProcess(handle.get()), record.name());
                deleteQuietly(pidFile);
            }
        }
    }

    private void adopt(PidRecord record, RuntimeConfig.RuntimeSlot slot, ProcessHandle handle) {
        tracked.put(record.name(), new TrackedChild(
            record.name(), slot, new HandleProcess(handle), slot.specHash(), record.startedAt()));
        log.info("Adopted runtime child {} (pid {})", record.name(), record.pid());
    }

    private void spawn(RuntimeConfig.RuntimeSlot slot) {
        Long runtimeId = resolveRuntimeId(slot);
        SpawnSpec spec = new SpawnSpec(
            slot.name(),
            slot.role(),
            slot.modelRef(),
            slot.effort(),
            slot.project(),
            runtimeId,
            heapMb,
            buildEnvironment(slot, runtimeId));
        Process process;
        try {
            process = launcher.launch(spec);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to launch runtime child " + slot.name(), e);
        }
        if (process == null) {
            throw new IllegalStateException("Child launcher returned null for " + slot.name());
        }
        PidRecord record = new PidRecord(
            process.pid(), slot.name(), slot.specHash(), processStart(process).toString());
        try {
            writePidFile(record);
        } catch (IOException e) {
            process.destroyForcibly();
            throw new IllegalStateException("Failed to write PID file for " + slot.name(), e);
        }
        tracked.put(slot.name(), new TrackedChild(
            slot.name(), slot, new ProcessAdapter(process), slot.specHash(), record.startedAt()));
        log.info("Started runtime child {} (pid {}, role {})",
            slot.name(), process.pid(), slot.role().wireName());
    }

    private Map<String, String> buildEnvironment(RuntimeConfig.RuntimeSlot slot, Long runtimeId) {
        Map<String, String> env = new LinkedHashMap<>();
        putIfPresent(env, "BACKEND_URL", System.getenv("BACKEND_URL"));
        putIfPresent(env, "AGENT_CREDENTIALS_FILE", System.getenv("AGENT_CREDENTIALS_FILE"));
        env.put("AGENT_RUNTIME_NAME", slot.runtimeName());
        env.put("AGENT_ROLE", slot.role().wireName());
        env.put("AGENT_LLM_MODEL", slot.modelRef());
        if (slot.effort() != null) {
            env.put("AGENT_EFFORT", slot.effort().wireName());
        }
        if (slot.project() != null) {
            env.put("AGENT_PROJECT_ID", slot.project());
        }
        if (runtimeId != null) {
            env.put("AGENT_RUNTIME_ID", String.valueOf(runtimeId));
        }
        env.put("AGENT_RUNTIME_CONCURRENCY", String.valueOf(concurrencyFor(slot.runtimeName())));
        env.put("AGENT_RUNTIME_STOP_FILE", stopMarkerPath(slot.runtimeName()).toString());
        return env;
    }

    private int concurrencyFor(String runtimeName) {
        RuntimeConfig current = config;
        if (current == null) return 1;
        for (RuntimeConfig.DeclaredRuntime runtime : current.runtimes()) {
            if (runtime.name().equals(runtimeName)) return runtime.count();
        }
        return 1;
    }

    private Long resolveRuntimeId(RuntimeConfig.RuntimeSlot slot) {
        Long id = runtimeIds.get(slot.name());
        return id != null ? id : runtimeIds.get(slot.runtimeName());
    }

    /**
     * Prefer the child's real start instant so a restarted supervisor can tell
     * its child from a recycled PID. Fake processes in tests may not expose a
     * handle; the wall clock is a safe fallback there.
     */
    private static Instant processStart(Process process) {
        try {
            return process.toHandle().info().startInstant().orElseGet(Instant::now);
        } catch (RuntimeException e) {
            return Instant.now();
        }
    }

    private void stopTracked(TrackedChild child) {
        long pid = child.process.pid();
        terminate(child.process, child.name);
        deletePidFileIfOwned(pidPath(child.name), pid);
        tracked.remove(child.name);
    }

    private void terminate(ManagedProcess process, String name) {
        if (!process.isAlive()) {
            return;
        }
        try {
            process.destroy();
        } catch (RuntimeException e) {
            log.debug("Could not send SIGTERM to {}: {}", name, e.getMessage());
        }
        if (process.awaitExit(stopTimeout)) {
            return;
        }
        log.warn("Runtime child {} did not stop within {}s; killing", name, stopTimeout.toSeconds());
        try {
            process.destroyForcibly();
        } catch (RuntimeException e) {
            log.debug("Could not send SIGKILL to {}: {}", name, e.getMessage());
        }
        if (!process.awaitExit(FORCE_KILL_TIMEOUT)) {
            log.warn("Runtime child {} is still alive after SIGKILL", name);
        }
    }

    private boolean pidReused(PidRecord record, ProcessHandle handle) {
        if (record.startedAt() == null || record.startedAt().isBlank()) {
            return false;
        }
        try {
            Instant recorded = Instant.parse(record.startedAt());
            Optional<Instant> actual = handle.info().startInstant();
            return actual.isPresent()
                && Math.abs(Duration.between(recorded, actual.get()).toSeconds()) > 5;
        } catch (RuntimeException e) {
            // An unparseable timestamp is not a reason to kill an unrelated process.
            return false;
        }
    }

    private Map<String, RuntimeConfig.RuntimeSlot> byName(List<RuntimeConfig.RuntimeSlot> slots) {
        Map<String, RuntimeConfig.RuntimeSlot> map = new LinkedHashMap<>();
        for (RuntimeConfig.RuntimeSlot slot : slots) {
            map.put(slot.name(), slot);
        }
        return map;
    }

    // ---------------------------------------------------------------------
    // PID files
    // ---------------------------------------------------------------------

    private Path pidPath(String childName) {
        return pidDir.resolve(childName + ".pid");
    }

    private List<Path> listPidFiles() {
        List<Path> files = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(pidDir, "*.pid")) {
            for (Path file : stream) {
                if (Files.isRegularFile(file)) {
                    files.add(file);
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot list supervisor PID directory " + pidDir, e);
        }
        files.sort(Comparator.comparing(path -> path.getFileName().toString()));
        return files;
    }

    private void writePidFile(PidRecord record) throws IOException {
        Path target = pidPath(record.name());
        byte[] bytes = MAPPER.writeValueAsBytes(record);
        Path temp = Files.createTempFile(pidDir, target.getFileName().toString() + ".", ".tmp");
        try {
            Files.write(temp, bytes, StandardOpenOption.TRUNCATE_EXISTING);
            try {
                Files.move(temp, target,
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    private PidRecord readPidRecord(Path file) {
        try {
            PidRecord record = MAPPER.readValue(Files.readAllBytes(file), PidRecord.class);
            if (record == null || record.pid() <= 0
                    || record.name() == null || record.name().isBlank()
                    || record.specHash() == null || record.specHash().isBlank()) {
                return null;
            }
            return record;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private void deletePidFileIfOwned(Path file, long expectedPid) {
        PidRecord record = readPidRecord(file);
        if (record != null && record.pid() != expectedPid) {
            return;
        }
        deleteQuietly(file);
    }

    private void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.warn("Could not delete supervisor PID file {}: {}", file.getFileName(), e.getMessage());
        }
    }

    private void ensureOpen() {
        if (closed) {
            throw new IllegalStateException("Supervisor is closed");
        }
    }

    private static void putIfPresent(Map<String, String> env, String key, String value) {
        if (value != null && !value.isBlank()) {
            env.put(key, value);
        }
    }

    // ---------------------------------------------------------------------
    // Default launcher
    // ---------------------------------------------------------------------

    /**
     * Build a launcher that starts the agent JAR ({@code AGENT_JAR}, default
     * {@code /app/agent.jar}) on the current JVM, or falls back to the current
     * classpath when the JAR is not present. Arguments contain no secrets.
     */
    public static ChildLauncher defaultLauncher() {
        return spec -> {
            ProcessBuilder builder = new ProcessBuilder(buildCommand(spec.heapMb()));
            builder.environment().putAll(spec.environment());
            builder.inheritIO();
            return builder.start();
        };
    }

    /** Build the child argv. Package-private so tests can assert no secrets leak. */
    static List<String> buildCommand(int heapMb) {
        List<String> command = new ArrayList<>();
        command.add(javaBinary());
        command.add("-Xmx" + heapMb + "m");
        Path jar = Path.of(System.getenv().getOrDefault("AGENT_JAR", DEFAULT_JAR));
        if (Files.isRegularFile(jar)) {
            command.add("-jar");
            command.add(jar.toString());
        } else {
            command.add("-cp");
            command.add(System.getProperty("java.class.path", "."));
            command.add(MAIN_CLASS);
        }
        return command;
    }

    private static String javaBinary() {
        String home = System.getProperty("java.home");
        if (home != null) {
            Path executable = Path.of(home, "bin", "java");
            if (Files.isExecutable(executable)) {
                return executable.toString();
            }
        }
        return "java";
    }

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /** Launches one child process. */
    @FunctionalInterface
    public interface ChildLauncher {
        Process launch(SpawnSpec spec) throws IOException;
    }

    /**
     * Immutable description of a child to launch.
     *
     * @param name        deterministic child name
     * @param role        runtime role
     * @param modelRef    model reference
     * @param effort      optional effort
     * @param project     optional project
     * @param runtimeId   backend runtime id, when known
     * @param heapMb      child JVM heap limit
     * @param environment environment entries for the child
     */
    public record SpawnSpec(
        String name,
        RuntimeConfig.Role role,
        String modelRef,
        RuntimeConfig.Effort effort,
        String project,
        Long runtimeId,
        int heapMb,
        Map<String, String> environment
    ) {
        public SpawnSpec {
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(role, "role");
            Objects.requireNonNull(modelRef, "modelRef");
            if (heapMb <= 0) {
                throw new IllegalArgumentException("heapMb must be positive");
            }
            environment = environment == null ? Map.of() : Map.copyOf(environment);
        }
    }

    /** Public snapshot of a tracked child. */
    public record ChildState(
        String name,
        long pid,
        String specHash,
        String role,
        String modelRef,
        String effort,
        String project,
        boolean alive
    ) {
    }

    /** JSON body of a PID file. */
    public record PidRecord(long pid, String name, String specHash, String startedAt) {
    }

    private record TrackedChild(
        String name,
        RuntimeConfig.RuntimeSlot slot,
        ManagedProcess process,
        String specHash,
        String startedAt
    ) {
    }

    private interface ManagedProcess {
        long pid();
        boolean isAlive();
        void destroy();
        void destroyForcibly();
        boolean awaitExit(Duration timeout);
    }

    private static final class ProcessAdapter implements ManagedProcess {
        private final Process process;

        private ProcessAdapter(Process process) {
            this.process = process;
        }

        @Override
        public long pid() {
            return process.pid();
        }

        @Override
        public boolean isAlive() {
            return process.isAlive();
        }

        @Override
        public void destroy() {
            process.destroy();
        }

        @Override
        public void destroyForcibly() {
            process.destroyForcibly();
        }

        @Override
        public boolean awaitExit(Duration timeout) {
            try {
                return process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return !process.isAlive();
            }
        }
    }

    private static final class HandleProcess implements ManagedProcess {
        private final ProcessHandle handle;

        private HandleProcess(ProcessHandle handle) {
            this.handle = handle;
        }

        @Override
        public long pid() {
            return handle.pid();
        }

        @Override
        public boolean isAlive() {
            return handle.isAlive();
        }

        @Override
        public void destroy() {
            handle.destroy();
        }

        @Override
        public void destroyForcibly() {
            handle.destroyForcibly();
        }

        @Override
        public boolean awaitExit(Duration timeout) {
            try {
                handle.onExit().get(timeout.toMillis(), TimeUnit.MILLISECONDS);
                return true;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return !handle.isAlive();
            } catch (java.util.concurrent.TimeoutException e) {
                return !handle.isAlive();
            } catch (java.util.concurrent.ExecutionException e) {
                return !handle.isAlive();
            }
        }
    }
}
