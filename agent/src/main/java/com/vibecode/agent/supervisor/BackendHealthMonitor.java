package com.vibecode.agent.supervisor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * fg-56 slice B: continuous post-start backend health monitoring.
 *
 * <p>The startup gate is a one-shot check. This monitor keeps probing the same
 * {@code /api/health} endpoint after startup, logs health transitions and
 * exposes {@link #isHealthy()} so the declaration/reconcile loop can pause while
 * the backend is unavailable. Failures back off exponentially up to a bound;
 * success resets the interval.</p>
 *
 * <p>Monitoring never logs credentials and never stops the supervisor. Compose
 * remains responsible for restarts (fg-56 D2).</p>
 */
final class BackendHealthMonitor implements AutoCloseable {

    static final long DEFAULT_INTERVAL_SECONDS = 10;
    static final long DEFAULT_MAX_BACKOFF_SECONDS = 60;

    private static final Logger log = LoggerFactory.getLogger(BackendHealthMonitor.class);

    private final String backendUrl;
    private final Duration baseInterval;
    private final Duration maxBackoff;
    private final ScheduledExecutorService executor;
    private final boolean active;

    private volatile boolean healthy = true;
    private volatile boolean closed;
    private volatile Duration backoff;

    BackendHealthMonitor(String backendUrl, Duration interval, Duration maxBackoff) {
        String url = backendUrl == null ? "" : backendUrl.trim();
        if (url.isEmpty()) {
            throw new IllegalArgumentException("backendUrl is required for the health monitor");
        }
        this.backendUrl = url;
        this.baseInterval = positive(interval, Duration.ofSeconds(DEFAULT_INTERVAL_SECONDS));
        this.maxBackoff = positive(maxBackoff, Duration.ofSeconds(DEFAULT_MAX_BACKOFF_SECONDS));
        this.backoff = this.baseInterval;
        this.executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "backend-health-monitor");
            thread.setDaemon(true);
            return thread;
        });
        this.active = true;
    }

    private BackendHealthMonitor() {
        this.backendUrl = null;
        this.baseInterval = Duration.ofSeconds(DEFAULT_INTERVAL_SECONDS);
        this.maxBackoff = Duration.ofSeconds(DEFAULT_MAX_BACKOFF_SECONDS);
        this.backoff = this.baseInterval;
        this.executor = null;
        this.active = false;
    }

    /** Build the monitor from env, or a no-op monitor when the gate is off. */
    static BackendHealthMonitor fromEnv(String backendUrl) {
        if (!BackendHealthGate.required(System.getenv("SUPERVISOR_HEALTH_REQUIRED"))
            || !enabled(System.getenv("SUPERVISOR_HEALTH_MONITOR_ENABLED"))) {
            return disabled();
        }
        return new BackendHealthMonitor(
            backendUrl,
            interval(System.getenv("SUPERVISOR_HEALTH_MONITOR_INTERVAL_SECONDS")),
            maxBackoff(System.getenv("SUPERVISOR_HEALTH_MONITOR_MAX_BACKOFF_SECONDS")));
    }

    static BackendHealthMonitor disabled() {
        return new BackendHealthMonitor();
    }

    void start() {
        if (!active) return;
        schedule(baseInterval);
    }

    boolean isHealthy() {
        return healthy;
    }

    @Override
    public void close() {
        closed = true;
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    private void tick() {
        if (closed) return;
        boolean ok = BackendHealthGate.probeOnce(backendUrl);
        Duration delay;
        if (ok) {
            if (!healthy) {
                log.info("Backend health restored: {}", backendUrl);
            }
            healthy = true;
            backoff = baseInterval;
            delay = baseInterval;
        } else {
            if (healthy) {
                log.warn("Backend health lost; pausing declaration/reconcile: {}", backendUrl);
            }
            healthy = false;
            delay = backoff;
            backoff = nextBackoff(backoff, maxBackoff);
        }
        schedule(delay);
    }

    private void schedule(Duration delay) {
        if (closed || executor == null) return;
        try {
            executor.schedule(this::tick, Math.max(1, delay.toMillis()), TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.RejectedExecutionException e) {
            // close() raced with a scheduled tick; nothing left to do.
        }
    }

    static Duration nextBackoff(Duration current, Duration max) {
        Duration safeCurrent = positive(current, Duration.ofSeconds(DEFAULT_INTERVAL_SECONDS));
        Duration safeMax = positive(max, Duration.ofSeconds(DEFAULT_MAX_BACKOFF_SECONDS));
        Duration doubled = safeCurrent.multipliedBy(2);
        return doubled.compareTo(safeMax) > 0 ? safeMax : doubled;
    }

    static boolean enabled(String value) {
        if (value == null || value.isBlank()) return true;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return !(normalized.equals("false") || normalized.equals("0")
            || normalized.equals("no") || normalized.equals("off"));
    }

    static Duration interval(String value) {
        return seconds(value, DEFAULT_INTERVAL_SECONDS);
    }

    static Duration maxBackoff(String value) {
        return seconds(value, DEFAULT_MAX_BACKOFF_SECONDS);
    }

    private static Duration seconds(String value, long fallbackSeconds) {
        if (value == null || value.isBlank()) {
            return Duration.ofSeconds(fallbackSeconds);
        }
        try {
            double seconds = Double.parseDouble(value.trim());
            return seconds > 0
                ? Duration.ofMillis(Math.max(1, Math.round(seconds * 1000)))
                : Duration.ofSeconds(fallbackSeconds);
        } catch (NumberFormatException e) {
            return Duration.ofSeconds(fallbackSeconds);
        }
    }

    private static Duration positive(Duration value, Duration fallback) {
        return value == null || value.isNegative() || value.isZero() ? fallback : value;
    }
}
