package com.vibecode.agent.harness;

import java.util.Locale;

/** Execution mode for repo-controlled commands. */
public enum SandboxMode {
    /**
     * Run commands directly on the supervisor filesystem. Only for local
     * development and the Phase 1 compatibility path; never a security boundary.
     */
    HOST,
    /** Run commands in a disposable, hardened Docker container. */
    DOCKER;

    public static SandboxMode from(String value) {
        if (value == null || value.isBlank()) {
            return HOST;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "host" -> HOST;
            case "docker" -> DOCKER;
            default -> throw new IllegalStateException(
                "SANDBOX_MODE must be one of: host, docker (got: " + value + ")");
        };
    }
}
