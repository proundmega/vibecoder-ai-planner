package com.vibecode.agent.harness;

import java.time.Duration;
import java.util.Map;

/**
 * One command to run inside a sandbox.
 *
 * @param cwd            relative to the workspace, or {@code /workspace}
 * @param maxOutputBytes hard cap on captured output
 */
public record ExecRequest(
    String command,
    String cwd,
    Duration timeout,
    int maxOutputBytes,
    Map<String, String> env
) {
    public static final int DEFAULT_MAX_OUTPUT_BYTES = 32_768;
    public static final Duration DEFAULT_TIMEOUT = Duration.ofMinutes(10);

    public ExecRequest {
        if (command == null || command.isBlank()) {
            throw new IllegalArgumentException("Sandbox command must not be blank");
        }
        timeout = timeout == null || timeout.isNegative() || timeout.isZero()
            ? DEFAULT_TIMEOUT
            : timeout;
        maxOutputBytes = maxOutputBytes <= 0 ? DEFAULT_MAX_OUTPUT_BYTES : maxOutputBytes;
        env = env == null ? Map.of() : Map.copyOf(env);
        SandboxSecurity.validateEnv(env, "sandbox command environment");
    }

    public static ExecRequest of(String command, Duration timeout) {
        return new ExecRequest(command, null, timeout, DEFAULT_MAX_OUTPUT_BYTES, Map.of());
    }

    public static ExecRequest of(String command, Duration timeout, Map<String, String> env) {
        return new ExecRequest(command, null, timeout, DEFAULT_MAX_OUTPUT_BYTES, env);
    }
}
