package com.vibecode.agent.service;

import java.io.IOException;

/**
 * Supplies the current GitHub credential. Implementations may refresh the
 * token; callers must treat the returned value as a secret and never persist
 * it in the workspace, process arguments or logs.
 */
@FunctionalInterface
public interface GitHubTokenSource {
    String get() throws IOException;

    /** Drops any cached credential after GitHub rejects it. */
    default void invalidate() {
    }
}
