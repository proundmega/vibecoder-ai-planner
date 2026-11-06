package com.vibecode.agent.harness;

/** Result of one sandboxed command. */
public record ExecResult(
    String command,
    int exitCode,
    String output,
    boolean timedOut,
    boolean truncated
) {
    public ExecResult {
        output = output == null ? "" : output;
    }

    public boolean passed() {
        return !timedOut && exitCode == 0;
    }
}
