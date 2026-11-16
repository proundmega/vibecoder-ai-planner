package com.vibecode.agent.harness;

import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-model circuit breaker (fg-38 FR7).
 *
 * <p>Consecutive transient provider failures open the circuit for a cooldown.
 * A successful call closes it again. The breaker is advisory to routing; the
 * supervisor always fails closed rather than looping.</p>
 */
public final class ProviderHealth {

    private static final int DEFAULT_THRESHOLD = 3;
    private static final Duration DEFAULT_COOLDOWN = Duration.ofMinutes(5);

    private final int failureThreshold;
    private final long cooldownMillis;
    private final Map<String, State> states = new ConcurrentHashMap<>();

    public ProviderHealth() {
        this(DEFAULT_THRESHOLD, DEFAULT_COOLDOWN);
    }

    public ProviderHealth(int failureThreshold, Duration cooldown) {
        this.failureThreshold = Math.max(1, failureThreshold);
        this.cooldownMillis = cooldown == null || cooldown.isNegative() || cooldown.isZero()
            ? DEFAULT_COOLDOWN.toMillis()
            : cooldown.toMillis();
    }

    public void recordSuccess(String model) {
        if (model == null) return;
        states.computeIfAbsent(key(model), ignored -> new State()).success();
    }

    public void recordFailure(String model, Throwable error) {
        if (model == null || !isTransient(error)) {
            return;
        }
        State state = states.computeIfAbsent(key(model), ignored -> new State());
        state.failure(System.currentTimeMillis(), failureThreshold, cooldownMillis);
    }

    public boolean isOpen(String model) {
        State state = model == null ? null : states.get(key(model));
        return state != null && state.isOpen(System.currentTimeMillis(), cooldownMillis);
    }

    public boolean isTransient(Throwable error) {
        if (error == null) return false;
        String message = String.valueOf(error.getMessage()).toLowerCase(Locale.ROOT);
        return message.contains("429")
            || message.contains("rate limit")
            || message.contains(" 500")
            || message.contains(" 502")
            || message.contains(" 503")
            || message.contains(" 504")
            || message.contains("timeout")
            || message.contains("timed out")
            || message.contains("connection")
            || message.contains("unavailable")
            || message.contains("overloaded")
            || message.contains("temporarily");
    }

    private static String key(String model) {
        return model.trim().toLowerCase(Locale.ROOT);
    }

    private static final class State {
        private int failures;
        private long openedAt;

        synchronized void success() {
            failures = 0;
            openedAt = 0;
        }

        synchronized void failure(long now, int threshold, long cooldown) {
            // Reset the window once a previous cooldown has elapsed.
            if (openedAt > 0 && now - openedAt >= cooldown) {
                failures = 0;
                openedAt = 0;
            }
            failures++;
            if (failures >= threshold) {
                openedAt = now;
            }
        }

        synchronized boolean isOpen(long now, long cooldown) {
            if (openedAt == 0) {
                return false;
            }
            if (now - openedAt >= cooldown) {
                failures = 0;
                openedAt = 0;
                return false;
            }
            return true;
        }
    }
}
