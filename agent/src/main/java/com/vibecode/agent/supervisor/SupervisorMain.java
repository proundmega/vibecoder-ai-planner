package com.vibecode.agent.supervisor;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.AgentAuthManager;
import com.vibecode.agent.service.AgentCredentialStore;
import com.vibecode.agent.service.AgentEnrollmentClient;
import com.vibecode.agent.service.RuntimeApi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Entry point for the host supervisor ({@code SUPERVISOR_CONFIG}).
 *
 * <p>The supervisor enrolls the node, declares the {@code agent.ini} runtimes
 * to the backend, and reconciles the child JVMs. The declaration is required
 * before the first child is spawned: a child without a server runtime id
 * cannot heartbeat or claim work. A failed re-declaration keeps the running
 * children and retries; it never tears down the fleet.</p>
 */
public final class SupervisorMain {

    private static final Logger log = LoggerFactory.getLogger(SupervisorMain.class);
    private static final Duration POLL_INTERVAL = Duration.ofSeconds(2);
    private static final int DEFAULT_HEAP_MB = 768;
    private static final int MIN_HEAP_MB = 128;
    private static final int DECLARE_ATTEMPTS = 10;

    private SupervisorMain() {
    }

    public static void run(String configPath) throws Exception {
        Path path = Path.of(configPath);
        RuntimeConfig desired = RuntimeConfig.parse(path);
        validateDeclaration(desired);
        AtomicReference<RuntimeConfig> desiredRef = new AtomicReference<>(desired);

        AgentConfig agentConfig = new AgentConfig();
        AgentCredentialStore store = new AgentCredentialStore(Path.of(agentConfig.getCredentialsFile()));
        AgentAuthManager auth = new AgentAuthManager(agentConfig, store, new AgentEnrollmentClient(agentConfig));
        auth.initialize();
        RuntimeApi api = new RuntimeApi(agentConfig, auth);
        assertNodeActive(api);

        // One declaration per section. The server returns one runtime row per
        // declaration; every child of that section shares the runtime id.
        Map<String, Long> runtimeIds = declareRequired(api, desired, DECLARE_ATTEMPTS);
        int heapMb = childHeapMb(desired);
        Path pidDir = Path.of(System.getenv().getOrDefault(
            "SUPERVISOR_PID_DIR", "/tmp/vibecode-runtimes"));
        Duration stopTimeout = Duration.ofSeconds(longEnv("SUPERVISOR_STOP_TIMEOUT_SECONDS", 10));

        Supervisor supervisor = new Supervisor(
            pidDir,
            desired,
            heapMb,
            Supervisor.defaultLauncher(),
            runtimeIds,
            stopTimeout,
            POLL_INTERVAL);
        supervisor.reconcile();
        log.info("Supervisor reconciled: desired={} running={}",
            desired.runtimes().size(),
            supervisor.snapshot().size());

        // A backend restart or a transient failure is retried with the current
        // desired set. The supervisor never spawns id-less children.
        ScheduledExecutorService retry = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "supervisor-declare-retry");
            thread.setDaemon(true);
            return thread;
        });
        java.util.concurrent.atomic.AtomicInteger tick = new java.util.concurrent.atomic.AtomicInteger();
        retry.scheduleWithFixedDelay(() -> {
            try {
                Map<String, Object> config = api.fetchConfig();
                if (!nodeActive(config)) {
                    log.info("Node is draining or revoked; stopping supervised runtimes");
                    supervisor.close();
                    return;
                }
                java.util.Map<String, Long> ids = supervisor.runtimeIdsSnapshot();
                java.util.Set<String> suspended = suspendedSections(config, ids);
                supervisor.updateSuspendedSections(suspended);
                for (String section : ids.keySet()) {
                    if (!suspended.contains(section)) {
                        // An admin restart (running/pending) clears a child's
                        // terminal stop marker.
                        supervisor.clearStopMarker(section);
                    }
                }
                RuntimeConfig current = desiredRef.get();
                supervisor.reconcile(current);

                // Re-declare less often than the status poll; a declaration
                // writes rows, while status polling only reconciles children.
                if (tick.incrementAndGet() % 4 == 0) {
                    Map<String, Long> refreshed = declareWithRetry(api, current, 1);
                    if (!refreshed.isEmpty()) {
                        supervisor.updateRuntimeIds(refreshed);
                    }
                }
            } catch (TerminalDeclarationException e) {
                log.error("Runtime declaration is permanently denied (HTTP {}); stopping supervised runtimes",
                    e.status());
                supervisor.close();
            } catch (com.vibecode.agent.service.AgentAuthFatalException e) {
                log.error("Node credentials are terminal; stopping supervised runtimes");
                supervisor.close();
            } catch (Exception e) {
                if (terminalConfigFailure(e)) {
                    log.error("Node/runtime is no longer authorized; stopping supervised runtimes: {}",
                        e.getMessage());
                    supervisor.close();
                    return;
                }
                log.debug("Runtime status/declaration refresh failed: {}", e.getMessage());
            }
        }, 5, 5, TimeUnit.SECONDS);

        installSignalHandlers(supervisor, path, api, desiredRef);
        try {
            supervisor.runLoop();
        } finally {
            retry.shutdownNow();
            supervisor.close();
        }
    }

    private static void installSignalHandlers(
        Supervisor supervisor,
        Path path,
        RuntimeApi api,
        AtomicReference<RuntimeConfig> desiredRef
    ) {
        try {
            sun.misc.Signal.handle(new sun.misc.Signal("HUP"), signal -> reload(api, supervisor, path, desiredRef));
        } catch (Throwable e) {
            log.warn("Could not register SIGHUP handler: {}", e.getMessage());
        }
        for (String name : new String[]{"TERM", "INT"}) {
            try {
                sun.misc.Signal.handle(new sun.misc.Signal(name), signal -> {
                    log.info("Supervisor received SIG{}", name);
                    supervisor.close();
                });
            } catch (Throwable e) {
                log.warn("Could not register SIG{} handler: {}", name, e.getMessage());
            }
        }
    }

    /**
     * Declare the ini runtimes and return section-name → runtime id. The first
     * boot must succeed before any child is spawned; a failed re-declaration
     * (SIGHUP/retry) leaves the running fleet alone.
     */
    static Map<String, Long> declareWithRetry(RuntimeApi api, RuntimeConfig config, int attempts) {
        List<Map<String, Object>> declared = new ArrayList<>();
        for (RuntimeConfig.DeclaredRuntime runtime : config.runtimes()) {
            Map<String, Object> row = new LinkedHashMap<>();
            // Stable section name: the server returns one runtime row per
            // declaration and every child in the section shares its id.
            row.put("name", runtime.name());
            row.put("role", runtime.role().wireName());
            row.put("modelRef", runtime.modelRef());
            row.put("concurrency", runtime.count());
            if (runtime.effort() != null) row.put("effort", runtime.effort().wireName());
            if (runtime.project() != null) row.put("projectId", runtime.project());
            declared.add(row);
        }

        RuntimeException last = null;
        for (int attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
            try {
                List<Map<String, Object>> returned = api.declareRuntimes(declared);
                Map<String, Long> ids = mapSectionRuntimeIds(config, returned);
                if (ids.isEmpty()) {
                    ids = mapSectionRuntimeIdsFromConfig(config, api.fetchConfig());
                }
                if (!ids.isEmpty()) {
                    return ids;
                }
                log.warn("Runtime declaration returned no usable ids (attempt {}/{})", attempt, attempts);
            } catch (RuntimeApi.RuntimeApiException e) {
                if (e.status() == 401 || e.status() == 403 || e.status() == 404) {
                    throw new TerminalDeclarationException(e.status(), e.getMessage(), e);
                }
                last = new RuntimeException(e.getMessage(), e);
                log.warn("Runtime declaration failed (attempt {}/{}): {}", attempt, attempts, e.getMessage());
            } catch (Exception e) {
                last = new RuntimeException(e.getMessage(), e);
                log.warn("Runtime declaration failed (attempt {}/{}): {}", attempt, attempts, e.getMessage());
            }
            if (attempt < attempts) {
                sleep(Math.min(30, attempt * 2));
            }
        }
        if (last != null) {
            log.warn("Runtime declaration still failing; keeping the current fleet");
        }
        return Map.of();
    }

    /**
     * Parse, declare and apply a reloaded config. The declaration must succeed
     * before new children spawn; otherwise the current fleet is left untouched.
     *
     * @return the applied config, or {@code null} when the reload was rejected
     */
    static RuntimeConfig reload(
        RuntimeApi api,
        Supervisor supervisor,
        Path path,
        AtomicReference<RuntimeConfig> desiredRef
    ) {
        try {
            RuntimeConfig reloaded = RuntimeConfig.parse(path);
            validateDeclaration(reloaded);
            Map<String, Long> ids = declareWithRetry(api, reloaded, 3);
            if (ids.isEmpty()) {
                log.error("SIGHUP reload rejected: runtime declaration failed; keeping the current fleet");
                return null;
            }
            supervisor.updateRuntimeIds(ids);
            desiredRef.set(reloaded);
            log.info("SIGHUP: reloading {} runtime declaration(s)", reloaded.runtimes().size());
            supervisor.reconcile(reloaded);
            return reloaded;
        } catch (Exception e) {
            // A bad edit must not take down the running fleet.
            log.error("SIGHUP reload rejected: {}", e.getMessage());
            return null;
        }
    }

    /** A declaration denied by auth/grant/model policy must not be retried forever. */
    public static class TerminalDeclarationException extends RuntimeException {
        private final int status;

        TerminalDeclarationException(int status, String message, Throwable cause) {
            super(message, cause);
            this.status = status;
        }

        public int status() {
            return status;
        }
    }

    static boolean terminalConfigFailure(Throwable error) {
        if (error instanceof com.vibecode.agent.service.AgentAuthFatalException) {
            return true;
        }
        String message = error == null ? "" : String.valueOf(error.getMessage());
        return message.contains("HTTP 401")
            || message.contains("HTTP 403")
            || message.contains("HTTP 404")
            || message.contains("TOKEN_REVOKED")
            || message.contains("TOKEN_EXPIRED");
    }

    @SuppressWarnings("unchecked")
    static java.util.Set<String> suspendedSections(Map<String, Object> config,
                                                  Map<String, Long> runtimeIds) {
        java.util.Set<String> suspended = new java.util.LinkedHashSet<>();
        if (config == null) return suspended;
        Map<Long, String> sectionById = new java.util.LinkedHashMap<>();
        if (runtimeIds != null) {
            runtimeIds.forEach((section, id) -> {
                if (id != null) sectionById.put(id, section);
            });
        }
        java.util.Set<String> activeGrants = new java.util.LinkedHashSet<>();
        Object grants = config.get("grants");
        if (grants instanceof List<?> grantList) {
            for (Object item : grantList) {
                if (item instanceof Map<?, ?> grant) {
                    String project = stringValue(((Map<String, Object>) grant).get("project_id"));
                    String role = stringValue(((Map<String, Object>) grant).get("role"));
                    if (project != null && role != null) activeGrants.add(project + ":" + role);
                }
            }
        }

        Object runtimes = config.get("runtimes");
        if (runtimes == null) runtimes = config.get("data");
        if (runtimes instanceof Map<?, ?> map) runtimes = map.get("runtimes");
        if (!(runtimes instanceof List<?> list)) return suspended;

        java.util.Set<String> seenSections = new java.util.LinkedHashSet<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> row)) continue;
            Map<String, Object> runtime = (Map<String, Object>) row;
            String status = stringValue(runtime.get("status"));
            String name = stringValue(runtime.get("name"));
            Long id = longValue(runtime.get("id"));
            String section = id != null ? sectionById.get(id) : null;
            if (section == null && name != null) {
                section = stripRuntimeSuffix(name);
            }
            if (section == null) continue;
            seenSections.add(section);

            if ("stopped".equalsIgnoreCase(status) || "draining".equalsIgnoreCase(status)) {
                suspended.add(section);
                continue;
            }
            String project = stringValue(runtime.get("current_project_id"));
            String role = stringValue(runtime.get("role"));
            if (project != null && role != null
                    && !activeGrants.contains(project + ":" + role)) {
                // Grant revoked or narrowed: stop this section instead of
                // letting the child heartbeat 403 and loop.
                suspended.add(section);
            }
        }

        // A runtime row removed from the node config retires its section.
        if (runtimeIds != null) {
            for (String section : runtimeIds.keySet()) {
                if (!seenSections.contains(section)) {
                    suspended.add(section);
                }
            }
        }
        return suspended;
    }

    static String stripRuntimeSuffix(String name) {
        if (name == null) return null;
        int dash = name.lastIndexOf('-');
        if (dash > 0 && dash < name.length() - 1) {
            String suffix = name.substring(dash + 1);
            if (suffix.chars().allMatch(Character::isDigit)) {
                return name.substring(0, dash);
            }
        }
        return name;
    }

    private static void assertNodeActive(RuntimeApi api) {
        try {
            if (!nodeActive(api.fetchConfig())) {
                throw new IllegalStateException("Node is draining or revoked; refusing to start runtimes");
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            // A config fetch failure is retried by the declaration path; do not
            // fail closed on a transient backend outage.
            log.warn("Could not read node status before startup: {}", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    static boolean nodeActive(Map<String, Object> config) {
        if (config == null) return true;
        Object node = config.get("node");
        String status = null;
        if (node instanceof Map<?, ?> map) {
            status = stringValue(((Map<String, Object>) map).get("status"));
        }
        if (status == null) {
            status = stringValue(config.get("status"));
        }
        return status == null || "active".equalsIgnoreCase(status);
    }

    /**
     * Track A's declare-runtimes contract requires a project for every worker.
     * Reject it before a child can start (and crash-loop) without one.
     */
    static void validateDeclaration(RuntimeConfig config) {
        for (RuntimeConfig.DeclaredRuntime runtime : config.runtimes()) {
            if (runtime.role() == RuntimeConfig.Role.WORKER
                    && (runtime.project() == null || runtime.project().isBlank())) {
                throw new IllegalArgumentException(
                    "worker runtime '" + runtime.name() + "' requires project");
            }
        }
    }

    /** First boot must have a declared runtime before any child starts. */
    static Map<String, Long> declareRequired(RuntimeApi api, RuntimeConfig config, int attempts) {
        Map<String, Long> ids = declareWithRetry(api, config, attempts);
        if (ids.isEmpty()) {
            throw new IllegalStateException(
                "Runtime declaration failed; refusing to start children without server runtime ids");
        }
        return ids;
    }

    /**
     * Map one returned runtime row per declared section to all of that
     * section's child slots. The server may echo the section name; if it
     * generated names, declaration order is the stable fallback.
     */
    static Map<String, Long> mapSectionRuntimeIds(RuntimeConfig config,
                                                  List<Map<String, Object>> runtimes) {
        Map<String, Long> ids = new LinkedHashMap<>();
        if (runtimes == null || runtimes.isEmpty()) return ids;
        Map<String, Long> byName = mapRuntimeIds(runtimes);
        for (RuntimeConfig.DeclaredRuntime declared : config.runtimes()) {
            Long id = byName.get(declared.name());
            if (id != null) ids.put(declared.name(), id);
        }
        if (ids.size() == config.runtimes().size()) {
            return ids;
        }
        // No usable names: the API returns one row per declaration in order.
        if (runtimes.size() == config.runtimes().size()) {
            ids.clear();
            for (int i = 0; i < runtimes.size(); i++) {
                Long id = longValue(runtimes.get(i).get("id"));
                if (id == null) return Map.of();
                ids.put(config.runtimes().get(i).name(), id);
            }
        }
        return ids;
    }

    static Map<String, Long> mapRuntimeIds(List<Map<String, Object>> runtimes) {
        Map<String, Long> ids = new LinkedHashMap<>();
        if (runtimes == null) return ids;
        for (Map<String, Object> runtime : runtimes) {
            Long id = longValue(runtime.get("id"));
            String name = stringValue(runtime.get("name"));
            if (id != null && name != null) {
                ids.put(name, id);
            }
        }
        return ids;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Long> mapSectionRuntimeIdsFromConfig(RuntimeConfig config,
                                                           Map<String, Object> nodeConfig) {
        if (nodeConfig == null) return Map.of();
        Object runtimes = nodeConfig.get("runtimes");
        if (runtimes == null) runtimes = nodeConfig.get("data");
        if (runtimes instanceof Map<?, ?> map) {
            runtimes = map.get("runtimes");
        }
        if (runtimes instanceof List<?> list) {
            return mapSectionRuntimeIds(config, (List<Map<String, Object>>) list);
        }
        return Map.of();
    }

    static int childHeapMb(RuntimeConfig config) {
        int perChild = intEnv("AGENT_RUNTIME_HEAP_MB", DEFAULT_HEAP_MB);
        int budget = intEnv("SUPERVISOR_MEMORY_BUDGET_MB", 0);
        int slots = Math.max(1, config.expandedSlots().size());
        if (budget > 0) {
            perChild = Math.min(perChild, Math.max(MIN_HEAP_MB, budget / slots));
        }
        return Math.max(MIN_HEAP_MB, perChild);
    }

    private static Long longValue(Object value) {
        if (value instanceof Number number) return number.longValue();
        if (value instanceof String text && !text.isBlank()) {
            try {
                return Long.parseLong(text);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static void sleep(long seconds) {
        try {
            Thread.sleep(Duration.ofSeconds(seconds).toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static int intEnv(String name, int fallback) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) return fallback;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long longEnv(String name, long fallback) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) return fallback;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
