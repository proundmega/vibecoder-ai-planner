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
        Map<String, Object> bootConfig = fetchNodeConfig(api);
        assertNodeActive(bootConfig);

        // A stopped/draining runtime or a revoked grant must survive a host
        // restart. Seed the skip set from the pre-declaration config (statuses
        // are available by section name before ids are mapped).
        java.util.Set<String> bootSuspended = bootSuspendedSections(desired, bootConfig);

        // One declaration per section. The server returns one runtime row per
        // declaration; every child of that section shares the runtime id.
        DeclarationResult declared =
            declareRequired(api, desired, DECLARE_ATTEMPTS, bootSuspended);
        Map<String, Long> runtimeIds = declared.runtimeIds();
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
        java.util.Set<String> initiallySuspended = new java.util.LinkedHashSet<>(declared.suspendedSections());
        initiallySuspended.addAll(declared.unresolvedSections());
        supervisor.updateSuspendedSections(initiallySuspended);
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
                // Admin stop/drain and revoked grants come from the config.
                // Keep previously denied sections suspended too, so an
                // all-denied host does not spawn id-less children between
                // declaration attempts.
                java.util.Set<String> configSuspended = suspendedSections(config, ids);
                java.util.Set<String> suspended = mergeSuspendedSections(
                    supervisor.suspendedSectionsSnapshot(), configSuspended, ids);
                DeclarationResult declaration = null;
                if (tick.incrementAndGet() % 4 == 0) {
                    // Only admin-suspended sections are skipped; a denied or
                    // unresolved section is retried so a re-grant recovers it.
                    declaration = declareWithRetry(api, desiredRef.get(), 1, configSuspended);
                    Map<String, Long> merged = new java.util.LinkedHashMap<>(ids);
                    merged.putAll(declaration.runtimeIds());
                    for (String section : declaration.suspendedSections()) {
                        merged.remove(section);
                    }
                    if (!merged.isEmpty()) {
                        supervisor.updateRuntimeIds(merged);
                    }
                    suspended.addAll(declaration.suspendedSections());
                    for (String section : declaration.runtimeIds().keySet()) {
                        if (!configSuspended.contains(section)) {
                            suspended.remove(section);
                        }
                    }
                    for (String section : declaration.unresolvedSections()) {
                        if (!merged.containsKey(section)) {
                            suspended.add(section);
                        }
                    }
                }
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
                if (declaration != null && declaration.terminal()) {
                    throw new TerminalDeclarationException(
                        declaration.terminalStatus(), declaration.message(), null);
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

    /** Result of declaring each section independently. */
    record DeclarationResult(
        Map<String, Long> runtimeIds,
        java.util.Set<String> suspendedSections,
        java.util.Set<String> unresolvedSections,
        boolean terminal,
        int terminalStatus,
        String message
    ) {
    }

    /**
     * Declare each section independently. A revoked grant affects only that
     * section (403); node-level auth failures (401/404) are terminal. This
     * keeps one project's revoked grant from stopping the whole host.
     */
    static DeclarationResult declareWithRetry(RuntimeApi api, RuntimeConfig config, int attempts) {
        return declareWithRetry(api, config, attempts, java.util.Set.of());
    }

    /**
     * Declare sections, skipping admin-suspended sections so a re-declaration
     * cannot revive a stopped runtime (Track A upserts stopped -> pending).
     */
    static DeclarationResult declareWithRetry(RuntimeApi api, RuntimeConfig config, int attempts,
                                              java.util.Set<String> skipSections) {
        Map<String, Long> ids = new LinkedHashMap<>();
        java.util.Set<String> suspended = new java.util.LinkedHashSet<>();
        RuntimeException last = null;
        java.util.Set<String> transientFailures = new java.util.LinkedHashSet<>();
        java.util.Set<String> skip = skipSections == null ? java.util.Set.of() : skipSections;

        for (int attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
            transientFailures = new java.util.LinkedHashSet<>();
            for (RuntimeConfig.DeclaredRuntime runtime : config.runtimes()) {
                if (skip.contains(runtime.name())) {
                    suspended.add(runtime.name());
                    continue;
                }
                Map<String, Object> row = declarationRow(runtime);
                try {
                    List<Map<String, Object>> returned = api.declareRuntimes(List.of(row));
                    Long id = mapSingleSectionId(runtime.name(), returned);
                    if (id == null) {
                        id = mapSingleSectionIdFromConfig(config, runtime.name(), api.fetchConfig());
                    }
                    if (id != null) {
                        ids.put(runtime.name(), id);
                        suspended.remove(runtime.name());
                    } else {
                        transientFailures.add(runtime.name());
                    }
                } catch (RuntimeApi.RuntimeApiException e) {
                    if (e.status() == 401 || e.status() == 404) {
                        return new DeclarationResult(ids, suspended, java.util.Set.of(), true, e.status(), e.getMessage());
                    }
                    if (e.status() == 403) {
                        // Section-level GRANT_REQUIRED / ROLE_NOT_ALLOWED: retire
                        // this section and keep the other projects running.
                        log.warn("Runtime section '{}' is denied by the backend (GRANT/ROLE): {}",
                            runtime.name(), e.getMessage());
                        suspended.add(runtime.name());
                        ids.remove(runtime.name());
                    } else {
                        transientFailures.add(runtime.name());
                        last = new RuntimeException(e.getMessage(), e);
                    }
                } catch (Exception e) {
                    transientFailures.add(runtime.name());
                    last = new RuntimeException(e.getMessage(), e);
                }
            }

            if (transientFailures.isEmpty()) {
                return new DeclarationResult(ids, suspended, java.util.Set.of(), false, 0, null);
            }
            log.warn("Runtime declaration failed for {} section(s) (attempt {}/{}): {}",
                transientFailures.size(), attempt, attempts,
                last != null ? last.getMessage() : "no ids returned");
            if (attempt < attempts) {
                sleep(Math.min(30, attempt * 2));
            }
        }
        return new DeclarationResult(ids, suspended, transientFailures, false, 0,
            last != null ? last.getMessage() : "runtime declaration returned no ids");
    }

    static Map<String, Object> declarationRow(RuntimeConfig.DeclaredRuntime runtime) {
        Map<String, Object> row = new LinkedHashMap<>();
        // Stable section name: Track A appends -<index> to derive runtime names.
        row.put("name", runtime.name());
        row.put("role", runtime.role().wireName());
        row.put("modelRef", runtime.modelRef());
        row.put("concurrency", runtime.count());
        if (runtime.effort() != null) row.put("effort", runtime.effort().wireName());
        if (runtime.project() != null) row.put("projectId", runtime.project());
        return row;
    }

    static Long mapSingleSectionId(String section, List<Map<String, Object>> runtimes) {
        if (runtimes == null || runtimes.isEmpty()) return null;
        for (Map<String, Object> runtime : runtimes) {
            String name = stringValue(runtime.get("name"));
            Long id = longValue(runtime.get("id"));
            if (id != null && name != null
                    && (section.equals(name) || name.startsWith(section + "-"))) {
                return id;
            }
        }
        return runtimes.size() == 1 ? longValue(runtimes.get(0).get("id")) : null;
    }

    @SuppressWarnings("unchecked")
    static Long mapSingleSectionIdFromConfig(RuntimeConfig config, String section,
                                             Map<String, Object> nodeConfig) {
        if (nodeConfig == null) return null;
        Object runtimes = nodeConfig.get("runtimes");
        if (runtimes == null) runtimes = nodeConfig.get("data");
        if (runtimes instanceof Map<?, ?> map) runtimes = map.get("runtimes");
        if (!(runtimes instanceof List<?> list)) return null;
        return mapSingleSectionId(section, (List<Map<String, Object>>) list);
    }

    /**
     * First boot must have at least one declared/active runtime. Sections whose
     * grant is revoked are returned as suspended, not as a host-wide failure.
     * A host whose every section is suspended stays up and idle so a re-grant
     * does not require a restart.
     */
    static DeclarationResult declareRequired(RuntimeApi api, RuntimeConfig config, int attempts) {
        return declareRequired(api, config, attempts, java.util.Set.of());
    }

    static DeclarationResult declareRequired(RuntimeApi api, RuntimeConfig config, int attempts,
                                             java.util.Set<String> skipSections) {
        DeclarationResult result = declareWithRetry(api, config, attempts, skipSections);
        if (result.terminal()) {
            throw new TerminalDeclarationException(
                result.terminalStatus(), result.message(), null);
        }
        if (result.runtimeIds().isEmpty()) {
            boolean allSuspended = result.unresolvedSections().isEmpty()
                && !result.suspendedSections().isEmpty();
            if (!allSuspended) {
                throw new IllegalStateException(
                    "Runtime declaration failed; refusing to start children without server runtime ids");
            }
            log.warn("Every runtime section is suspended; supervisor will idle and retry");
        }
        return result;
    }

    /**
     * Carry a denied/unresolved section's suspension forward while it has no
     * runtime id, and release it once the server reports it healthy again.
     */
    static java.util.Set<String> mergeSuspendedSections(
        java.util.Set<String> previous,
        java.util.Set<String> configSuspended,
        Map<String, Long> runtimeIds
    ) {
        java.util.Set<String> suspended = new java.util.LinkedHashSet<>();
        if (previous != null) suspended.addAll(previous);
        if (configSuspended != null) suspended.addAll(configSuspended);
        if (runtimeIds != null) {
            for (String section : runtimeIds.keySet()) {
                if (configSuspended == null || !configSuspended.contains(section)) {
                    suspended.remove(section);
                }
            }
        }
        return suspended;
    }

    /**
     * Sections that must not be declared at boot: stopped/draining rows or a
     * runtime whose project grant no longer matches. Unknown ini sections are
     * declared normally so a new section still gets its server row.
     */
    static java.util.Set<String> bootSuspendedSections(RuntimeConfig config,
                                                       Map<String, Object> nodeConfig) {
        if (nodeConfig == null) return java.util.Set.of();
        java.util.Set<String> known = new java.util.LinkedHashSet<>();
        for (RuntimeConfig.DeclaredRuntime runtime : config.runtimes()) {
            known.add(runtime.name());
        }
        java.util.Set<String> suspended = suspendedSections(nodeConfig, null);
        suspended.retainAll(known);
        return suspended;
    }

    /**
     * Parse, declare and apply a reloaded config. Sections whose grant is
     * revoked are suspended; terminal node auth failures keep the old fleet.
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
            DeclarationResult declared = declareWithRetry(
                api, reloaded, 3, supervisor.suspendedSectionsSnapshot());
            if (declared.terminal()) {
                log.error("SIGHUP reload rejected: node auth failed; keeping the current fleet");
                return null;
            }
            if (declared.runtimeIds().isEmpty()) {
                log.error("SIGHUP reload rejected: runtime declaration failed; keeping the current fleet");
                return null;
            }
            supervisor.updateRuntimeIds(declared.runtimeIds());
            java.util.Set<String> reloadSuspended = new java.util.LinkedHashSet<>(declared.suspendedSections());
            reloadSuspended.addAll(declared.unresolvedSections());
            supervisor.updateSuspendedSections(reloadSuspended);
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

    /**
     * Fetch the node config before startup. A terminal auth failure is
     * propagated immediately; a transient outage is retried by the
     * declaration path instead of failing the host closed.
     */
    static Map<String, Object> fetchNodeConfig(RuntimeApi api) {
        try {
            return api.fetchConfig();
        } catch (Exception e) {
            if (terminalConfigFailure(e)) {
                throw new IllegalStateException(
                    "Node credential is terminal at startup: " + e.getMessage(), e);
            }
            log.warn("Could not read node status before startup: {}", e.getMessage());
            return null;
        }
    }

    static void assertNodeActive(Map<String, Object> config) {
        if (!nodeActive(config)) {
            throw new IllegalStateException("Node is draining or revoked; refusing to start runtimes");
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
