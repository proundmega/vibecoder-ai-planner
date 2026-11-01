package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Path;
import java.util.function.Consumer;

/**
 * Execution harness abstraction. Phase 1 is implemented by {@link OpenCodeClient}.
 */
public interface HarnessClient extends AutoCloseable {
    void start(Path workspace) throws IOException;

    String createSession(String title) throws IOException;

    void sendPrompt(String sessionId, String prompt) throws IOException;

    default void subscribe(String sessionId, Consumer<HarnessEvent> listener) throws IOException {
        // Event streaming is optional in Phase 1; the harness prompt blocks until done.
    }

    DiffSummary getDiff(String sessionId) throws IOException;

    boolean isHealthy();

    @Override
    void close();
}
