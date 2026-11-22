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

    /**
     * Reply to a blocked OpenCode question/permission request (fg-55). The
     * default fails closed: a harness that cannot resume must not pretend it
     * did, because the run would continue without the human decision.
     */
    default void replyToQuestion(
        String sessionId,
        String requestId,
        String kind,
        String answer
    ) throws IOException {
        throw new IOException("This harness cannot resume a question");
    }

    /** Reject/abort a blocked question (timeout or operator abort). */
    default void rejectQuestion(String sessionId, String requestId, String kind)
        throws IOException {
        throw new IOException("This harness cannot reject a question");
    }

    boolean isHealthy();

    @Override
    void close();
}
