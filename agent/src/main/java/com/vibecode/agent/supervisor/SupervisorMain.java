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

/**
 * Entry point for the host supervisor ({@code SUPERVISOR_CONFIG}).
 *
 * <p>The supervisor enrolls the node, declares the {@code agent.ini} runtimes
 * to the backend, and reconciles the child JVMs. If the backend is unreachable
 * it keeps the current children and retries; it never treats a failed config
 * fetch as a reason to stop the fleet.</p>
 */
public final class SupervisorMain {

    private static final Logger log = LoggerFactory.getLogger(SupervisorMain.class);
    private static final Duration DEFAULT_STOP_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration POLL_INTERVAL = Duration.ofSeconds(2);
    private static final int DEFAULT_HEAP_MB = 768;
    private static final int MIN_HEAP_MB = 128;

    private SupervisorMain() {
    }

    public static void run(String configPath) throws Exception {
        Path path = Path.of(configPath);
        RuntimeConfig desired = RuntimeConfig.parse(path);

        AgentConfig agentConfig = new AgentConfig();
        AgentCredentialStore store = new AgentCredentialStore(Path.of(agentConfig.getCredentialsFile()));
        AgentAuthManager auth = new AgentAuthManager(agentConfig, store, new AgentEnrollmentClient(agentConfig));
        auth.initialize();
        RuntimeApi api = new RuntimeApi(agentConfig, auth);

        Map<String, Long> runtimeIds = declareWithRetry(api, desired, 5);
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
            desired.expandedSlots().size(),
            supervisor.snapshot().size());

        // The declaration is retried in the background so a backend restart
        // does not leave the runtimes without records. Children also resolve
        // their id from the node config on boot.
        ScheduledExecutorService retry = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "supervisor-declare-retry");
            thread.setDaemon(true);
            return thread;
        });
        retry.scheduleWithFixedDelay(() -> {
            try {
                declareWithRetry(api, desired, 1);
            } catch (RuntimeException e) {
                log.debug("Runtime re-declaration failed: {}", e.getMessage());
            }
        }, 60, 60, TimeUnit.SECONDS);

        installSignalHandlers(supervisor, path);
        try {
            supervisor.runLoop();
        } finally {
            retry.shutdownNow();
            supervisor.close();
        }
    }

    private static void installSignalHandlers(Supervisor supervisor, Path path) {
        try {
            sun.misc.Signal.handle(new sun.misc.Signal("HUP"), signal -> {
                try {
                    RuntimeConfig reloaded = RuntimeConfig.parse(path);
                    log.info("SIGHUP: reloading {} runtime declaration(s)", reloaded.runtimes().size());
                    supervisor.reconcile(reloaded);
                } catch (Exception e) {
                    // A bad edit must not take down the running fleet.
                    log.error("SIGHUP reload rejected: {}", e.getMessage());
                }
            });
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
     * Declare the ini runtimes and return child-name → runtime id. A failure is
     * retried; after the attempts are exhausted the supervisor still starts,
     * and children resolve their own id from the node config.
     */
    static Map<String, Long> declareWithRetry(RuntimeApi api, RuntimeConfig config, int attempts) {
        List<Map<String, Object>> declared = new ArrayList<>();
        for (RuntimeConfig.DeclaredRuntime runtime : config.runtimes()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("role", runtime.role().wireName());
            row.put("modelRef", runtime.modelRef());
            row.put("count", runtime.count());
            if (runtime.effort() != null) row.put("effort", runtime.effort().wireName());
            if (runtime.project() != null) row.put("project", runtime.project());
            declared.add(row);
        }

        RuntimeException last = null;
        for (int attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
            try {
                List<Map<String, Object>> returned = api.declareRuntimes(declared);
                Map<String, Long> ids = mapRuntimeIds(returned);
                if (ids.isEmpty()) {
                    ids = mapIdsInOrder(config, returned);
                }
                if (ids.isEmpty()) {
                    ids = mapRuntimeIdsFromConfig(api.fetchConfig());
                }
                if (!ids.isEmpty()) {
                    return ids;
                }
                log.warn("Runtime declaration returned no ids (attempt {}/{})", attempt, attempts);
            } catch (Exception e) {
                last = new RuntimeException(e.getMessage(), e);
                log.warn("Runtime declaration failed (attempt {}/{}): {}", attempt, attempts, e.getMessage());
            }
            if (attempt < attempts) {
                sleep(Math.min(30, attempt * 2));
            }
        }
        if (last != null) {
            log.warn("Starting with unresolved runtime ids; children will resolve them from the node config");
        }
        return Map.of();
    }

    /**
     * The API contract declares a runtime set without client names. When the
     * response has no usable names, map ids to the deterministic slots in
     * declaration order.
     */
    static Map<String, Long> mapIdsInOrder(RuntimeConfig config, List<Map<String, Object>> runtimes) {
        Map<String, Long> ids = new LinkedHashMap<>();
        if (runtimes == null || runtimes.isEmpty()) return ids;
        List<RuntimeConfig.RuntimeSlot> slots = config.expandedSlots();
        if (slots.size() != runtimes.size()) return ids;
        for (int i = 0; i < slots.size(); i++) {
            Long id = longValue(runtimes.get(i).get("id"));
            if (id == null) return Map.of();
            ids.put(slots.get(i).name(), id);
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
    static Map<String, Long> mapRuntimeIdsFromConfig(Map<String, Object> config) {
        if (config == null) return Map.of();
        Object runtimes = config.get("runtimes");
        if (runtimes == null) runtimes = config.get("data");
        if (runtimes instanceof Map<?, ?> map) {
            runtimes = map.get("runtimes");
        }
        if (runtimes instanceof List<?> list) {
            List<Map<String, Object>> rows = (List<Map<String, Object>>) list;
            return mapRuntimeIds(rows);
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
