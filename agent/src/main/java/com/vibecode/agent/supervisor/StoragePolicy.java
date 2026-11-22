package com.vibecode.agent.supervisor;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * fg-44 storage policy: role budgets, idle/max lifetime and the five
 * disk/inode watermarks.
 */
public record StoragePolicy(
    long idleRefreshMs,
    int maxLifetimeHours,
    int warnPct,
    int stopPct,
    int cleanPct,
    int recyclePct,
    int manualPct,
    long workspaceTtlHours,
    long orphanTtlHours
) {

    public enum StorageAction {
        OK,
        WARN,
        STOP_SPAWN,
        CLEAN_IDLE,
        RECYCLE_OLDEST,
        MANUAL_RECOVERY
    }

    public record Usage(double usedPct, double inodePct) {
    }

    public record RuntimeState(
        String role,
        long budgetGb,
        boolean activeTicket,
        boolean activeLease,
        boolean sandboxActive,
        boolean harnessActive,
        Instant lastActivityAt,
        Instant startedAt
    ) {
        public boolean idle() {
            return !activeTicket && !activeLease && !sandboxActive && !harnessActive;
        }
    }

    public static StoragePolicy fromEnv(Map<String, String> env) {
        Map<String, String> source = env == null ? Map.of() : env;
        return new StoragePolicy(
            longValue(source, "AGENT_IDLE_REFRESH_MS", 7_200_000L),
            intValue(source, "AGENT_MAX_LIFETIME_HOURS", 24),
            pct(source, "AGENT_STORAGE_WARN_PCT", 70),
            pct(source, "AGENT_STORAGE_STOP_PCT", 80),
            pct(source, "AGENT_STORAGE_CLEAN_PCT", 85),
            pct(source, "AGENT_STORAGE_RECYCLE_PCT", 90),
            pct(source, "AGENT_STORAGE_MANUAL_PCT", 95),
            longValue(source, "HARNESS_WORKSPACE_RETENTION_HOURS", 24),
            longValue(source, "AGENT_ORPHAN_TTL_HOURS", 24)
        );
    }

    public static long budgetGbFor(String role, String override) {
        if (override != null && !override.isBlank()) {
            try {
                long parsed = Long.parseLong(override.trim());
                if (parsed > 0) return parsed;
            } catch (NumberFormatException ignored) {
                // Fall through to the role default.
            }
        }
        if (role == null) return 20;
        return switch (role.toLowerCase(java.util.Locale.ROOT)) {
            case "reviewer", "planner" -> 10;
            case "light" -> 5;
            default -> 20;
        };
    }

    public StorageAction evaluate(Usage usage, RuntimeState state) {
        double disk = usage == null ? 0 : usage.usedPct();
        double inodes = usage == null ? 0 : usage.inodePct();
        double worst = Math.max(disk, inodes);
        if (worst >= manualPct) return StorageAction.MANUAL_RECOVERY;
        if (worst >= recyclePct) {
            return state != null && state.idle() ? StorageAction.RECYCLE_OLDEST
                : StorageAction.STOP_SPAWN;
        }
        if (worst >= cleanPct) {
            return state != null && state.idle() ? StorageAction.CLEAN_IDLE
                : StorageAction.STOP_SPAWN;
        }
        if (worst >= stopPct) return StorageAction.STOP_SPAWN;
        if (worst >= warnPct) return StorageAction.WARN;
        if (state != null && state.idle() && lastActivityExpired(state)) {
            return StorageAction.CLEAN_IDLE;
        }
        return StorageAction.OK;
    }

    private boolean lastActivityExpired(RuntimeState state) {
        if (state.lastActivityAt() == null) return false;
        return Duration.between(state.lastActivityAt(), Instant.now())
            .toMillis() >= idleRefreshMs;
    }

    public boolean lifetimeExpired(RuntimeState state) {
        if (state == null || state.startedAt() == null || !state.idle()) return false;
        return Duration.between(state.startedAt(), Instant.now())
            .toHours() >= maxLifetimeHours;
    }

    private static long longValue(Map<String, String> env, String key, long fallback) {
        String value = env.get(key);
        if (value == null || value.isBlank()) return fallback;
        try {
            long parsed = Long.parseLong(value.trim());
            return parsed >= 0 ? parsed : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static int intValue(Map<String, String> env, String key, int fallback) {
        long parsed = longValue(env, key, fallback);
        return parsed > Integer.MAX_VALUE ? fallback : (int) parsed;
    }

    private static int pct(Map<String, String> env, String key, int fallback) {
        int value = intValue(env, key, fallback);
        return value > 0 && value <= 100 ? value : fallback;
    }
}
