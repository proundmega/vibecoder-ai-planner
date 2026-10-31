package com.vibecode.agent.harness;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.function.Function;

/**
 * Harness configuration derived from environment variables.
 *
 * <p>Defaults are intentionally conservative; the legacy one-shot path stays the
 * default until {@code HARNESS_MODE=opencode} is set explicitly.</p>
 */
public record HarnessConfig(
    String mode,
    String binary,
    Duration startupTimeout,
    Duration idleTimeout,
    Duration maxDuration,
    List<String> verificationCommands,
    List<String> protectedPaths,
    String modelOverride
) {

    public static final String DEFAULT_MODE = "legacy";
    public static final String DEFAULT_BINARY = "opencode";
    public static final String DEFAULT_PROTECTED_PATHS =
        ".env*;.github/workflows/**;**/secrets/**";

    public static HarnessConfig fromEnvironment() {
        return from(System::getenv);
    }

    /**
     * Parses a configuration from an environment lookup. Kept package-visible so
     * tests do not need to mutate process environment variables.
     */
    public static HarnessConfig from(Function<String, String> env) {
        String mode = value(env, "HARNESS_MODE", DEFAULT_MODE);
        String binary = value(env, "HARNESS_BIN", DEFAULT_BINARY);
        long startupMs = longValue(env, "HARNESS_STARTUP_TIMEOUT_MS", 30_000L);
        long idleMs = longValue(env, "HARNESS_IDLE_TIMEOUT_MS", 300_000L);
        long maxMinutes = longValue(env, "HARNESS_MAX_DURATION_MINUTES", 45L);

        String model = value(env, "HARNESS_MODEL", "");

        return new HarnessConfig(
            mode,
            binary,
            Duration.ofMillis(startupMs),
            Duration.ofMillis(idleMs),
            Duration.ofMinutes(maxMinutes),
            split(value(env, "HARNESS_VERIFY_COMMANDS", "")),
            split(value(env, "HARNESS_PROTECTED_PATHS", DEFAULT_PROTECTED_PATHS)),
            model.isBlank() ? null : model
        );
    }

    public boolean isEnabled() {
        return "opencode".equalsIgnoreCase(mode);
    }

    public void validate() {
        if (binary == null || binary.isBlank()) {
            throw new IllegalStateException("HARNESS_BIN must not be blank");
        }
        requirePositive(startupTimeout, "HARNESS_STARTUP_TIMEOUT_MS");
        requirePositive(idleTimeout, "HARNESS_IDLE_TIMEOUT_MS");
        requirePositive(maxDuration, "HARNESS_MAX_DURATION_MINUTES");
    }

    private static void requirePositive(Duration duration, String name) {
        if (duration == null || duration.isNegative() || duration.isZero()) {
            throw new IllegalStateException(name + " must be positive");
        }
    }

    private static String value(Function<String, String> env, String name, String fallback) {
        String value = env.apply(name);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static long longValue(Function<String, String> env, String name, long fallback) {
        String value = env.apply(name);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            long parsed = Long.parseLong(value.trim());
            return parsed > 0 ? parsed : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static List<String> split(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        return Arrays.stream(value.split(";"))
            .map(String::trim)
            .filter(part -> !part.isBlank())
            .toList();
    }
}
