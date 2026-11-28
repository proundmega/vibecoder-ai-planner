package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Runs one read-only review session (fg-31c, FR1/FR3).
 *
 * <p>The client owns the OpenCode lifecycle and prompt/event handling; the
 * caller owns the disposable workspace and supervisor verification. The
 * OpenCode config denies the write/edit bridge tools and the shell, and the
 * returned text is the assistant's final message for
 * {@link ReviewResultParser}.</p>
 */
public final class ReviewHarnessClient implements AutoCloseable {

    static final Duration DEFAULT_TERMINAL_TIMEOUT = Duration.ofSeconds(15);

    private final HarnessClient harness;
    private final ReviewPromptBuilder promptBuilder;
    private final Duration terminalTimeout;
    private final HarnessPromptRunner runner;

    public ReviewHarnessClient(HarnessClient harness) {
        this(harness, new ReviewPromptBuilder(), DEFAULT_TERMINAL_TIMEOUT);
    }

    ReviewHarnessClient(
        HarnessClient harness,
        ReviewPromptBuilder promptBuilder,
        Duration terminalTimeout
    ) {
        if (harness == null) {
            throw new IllegalArgumentException("harness is required");
        }
        this.harness = harness;
        this.promptBuilder = promptBuilder == null ? new ReviewPromptBuilder() : promptBuilder;
        this.terminalTimeout = terminalTimeout == null || terminalTimeout.isNegative()
            ? DEFAULT_TERMINAL_TIMEOUT
            : terminalTimeout;
        this.runner = new HarnessPromptRunner(
            "review", "reviewer returned no review text", this.terminalTimeout);
    }

    /**
     * Production factory. {@code reviewMode} denies the guarded write/edit
     * tools and the shell while leaving the workspace writable for the
     * supervisor's verification.
     */
    public static ReviewHarnessClient open(
        HarnessConfig config,
        ProviderSettings provider,
        Path tempDir
    ) {
        return new ReviewHarnessClient(
            new OpenCodeClient(config, provider, tempDir, null, true));
    }

    /**
     * Start the harness in the workspace, send the review prompt and return the
     * assistant's final text. OpenCode event delivery is asynchronous, so a
     * blank transcript waits for a terminal (idle/error) event. An empty or
     * unhealthy result is an IOException so the processor fails closed.
     */
    public String review(Path workspace, String title, ReviewPromptBuilder.Request request)
        throws IOException {
        if (request == null) {
            throw new IOException("review prompt request is required");
        }
        return review(workspace, title, promptBuilder.build(request));
    }

    public String review(Path workspace, String title, String prompt) throws IOException {
        if (workspace == null) {
            throw new IOException("review workspace is required");
        }
        if (prompt == null || prompt.isBlank()) {
            throw new IOException("review prompt is required");
        }
        return runner.run(harness, workspace, title, prompt);
    }

    public boolean isHealthy() {
        return harness.isHealthy();
    }

    @Override
    public void close() {
        harness.close();
    }
}
