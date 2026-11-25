package com.vibecode.agent.harness;

import java.util.Locale;
import java.util.function.Function;

/**
 * Review rollout mode (fg-31d, FR10).
 *
 * <p>{@code REVIEW_HARNESS_MODE=legacy} is the default and keeps the existing
 * reviewer. {@code opencode} selects the harness path. {@code
 * REVIEW_LEGACY_SHADOW=true} keeps legacy comments but suppresses its status
 * writes during the bake.</p>
 */
public record ReviewMode(Mode mode, boolean legacyShadow) {

    public enum Mode {
        LEGACY,
        OPENCODE
    }

    public static ReviewMode fromEnvironment() {
        return from(System::getenv);
    }

    static ReviewMode from(Function<String, String> env) {
        String raw = env.apply("REVIEW_HARNESS_MODE");
        Mode mode;
        if (raw == null || raw.isBlank() || "legacy".equalsIgnoreCase(raw.trim())) {
            mode = Mode.LEGACY;
        } else if ("opencode".equalsIgnoreCase(raw.trim())) {
            mode = Mode.OPENCODE;
        } else {
            throw new IllegalArgumentException(
                "REVIEW_HARNESS_MODE must be 'legacy' or 'opencode'");
        }
        return new ReviewMode(mode, boolValue(env.apply("REVIEW_LEGACY_SHADOW")));
    }

    public boolean harnessEnabled() {
        return mode == Mode.OPENCODE;
    }

    public boolean legacyWritesAllowed() {
        return mode == Mode.LEGACY && !legacyShadow;
    }

    private static boolean boolValue(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "1", "true", "yes", "on" -> true;
            case "0", "false", "no", "off" -> false;
            default -> throw new IllegalArgumentException(
                "REVIEW_LEGACY_SHADOW must be a boolean");
        };
    }
}
