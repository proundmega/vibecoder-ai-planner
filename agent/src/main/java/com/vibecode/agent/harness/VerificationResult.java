package com.vibecode.agent.harness;

/**
 * Result of one verification command.
 */
public record VerificationResult(String command, int exitCode, String output, boolean timedOut) {
    public boolean passed() {
        return !timedOut && exitCode == 0;
    }
}
