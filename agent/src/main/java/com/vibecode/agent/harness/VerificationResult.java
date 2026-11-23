package com.vibecode.agent.harness;

/**
 * Result of one verification command.
 *
 * <p>{@code attempts} and {@code flaky} describe the fg-39 slice 3 retry
 * policy: a failed command is retried only when its output names a
 * {@code flaky_tests} entry, and a flake is recorded even when a retry passes.
 * A consistent failure still fails the run.</p>
 */
public record VerificationResult(
    String command,
    int exitCode,
    String output,
    boolean timedOut,
    int attempts,
    boolean flaky
) {
    public VerificationResult(String command, int exitCode, String output, boolean timedOut) {
        this(command, exitCode, output, timedOut, 1, false);
    }

    public boolean passed() {
        return !timedOut && exitCode == 0;
    }
}
