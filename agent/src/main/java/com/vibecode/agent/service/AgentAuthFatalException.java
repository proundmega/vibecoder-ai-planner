package com.vibecode.agent.service;

import java.io.IOException;

/**
 * Raised when a node can no longer obtain a usable credential after bounded
 * retries. The supervisor must exit non-zero so the orchestrator surfaces the
 * operator action (re-enroll) instead of looping forever.
 */
public class AgentAuthFatalException extends IOException {
    public AgentAuthFatalException(String message, Throwable cause) {
        super(message, cause);
    }
}
