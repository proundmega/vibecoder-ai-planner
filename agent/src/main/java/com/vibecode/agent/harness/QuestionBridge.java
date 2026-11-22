package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Persists a human question through the backend and polls until it is answered
 * or expires (fg-55 FR2/FR3/FR4).
 *
 * <p>The OpenCode prompt call stays blocked in another thread while this bridge
 * waits. Replying on a second HTTP connection is what resumes the session. If
 * the pinned server cannot reply, the caller fails the run instead of faking a
 * resume.</p>
 */
public final class QuestionBridge {

    public interface Transport {
        long createHarnessQuestion(
            String runId,
            String externalId,
            String kind,
            String prompt,
            JsonNode options,
            Instant expiresAt
        ) throws IOException;

        Map<String, Object> getHarnessQuestion(String runId, long questionId) throws IOException;

        void expireHarnessQuestion(String runId, long questionId) throws IOException;
    }

    public record PendingQuestion(long id, String kind, String externalId) {
    }

    public record Answer(String status, String text) {
        public boolean answered() {
            return "answered".equals(status);
        }
    }

    private static final int MAX_PROMPT = 8192;

    private final Transport transport;
    private final String runId;
    private final HarnessConfig.QuestionLoopConfig config;
    private final Supplier<Instant> clock;

    public QuestionBridge(
        Transport transport,
        String runId,
        HarnessConfig.QuestionLoopConfig config
    ) {
        this(transport, runId, config, Instant::now);
    }

    QuestionBridge(
        Transport transport,
        String runId,
        HarnessConfig.QuestionLoopConfig config,
        Supplier<Instant> clock
    ) {
        if (transport == null) {
            throw new IllegalArgumentException("transport is required");
        }
        if (runId == null || runId.isBlank()) {
            throw new IllegalArgumentException("runId is required");
        }
        if (config == null) {
            throw new IllegalArgumentException("question config is required");
        }
        this.transport = transport;
        this.runId = runId;
        this.config = config;
        this.clock = clock == null ? Instant::now : clock;
    }

    public PendingQuestion ask(String kind, String externalId, String prompt, JsonNode options)
        throws IOException {
        String questionKind = kind == null || kind.isBlank() ? "question" : kind;
        String text = prompt == null || prompt.isBlank()
            ? "The harness needs a human decision to continue."
            : prompt.trim();
        if (text.length() > MAX_PROMPT) {
            text = text.substring(0, MAX_PROMPT);
        }
        String id = externalId == null || externalId.isBlank()
            ? "evt-" + UUID.randomUUID()
            : externalId;
        long questionId = transport.createHarnessQuestion(
            runId, id, questionKind, text, options, clock.get().plus(config.timeout()));
        return new PendingQuestion(questionId, questionKind, id);
    }

    /**
     * Poll until answered, expired/cancelled, or the configured timeout. On
     * timeout the question is expired through the backend, which clears the
     * run's waiting marker.
     */
    public Answer waitForAnswer(PendingQuestion question)
        throws IOException, InterruptedException {
        Instant deadline = clock.get().plus(config.timeout());
        while (true) {
            Map<String, Object> row = transport.getHarnessQuestion(runId, question.id());
            String status = text(row.get("status"));
            if ("answered".equals(status)) {
                return new Answer("answered", text(row.get("answer")));
            }
            if (status != null && !"pending".equals(status)) {
                return new Answer(status, null);
            }
            Instant now = clock.get();
            if (!now.isBefore(deadline)) {
                transport.expireHarnessQuestion(runId, question.id());
                return new Answer("expired", null);
            }
            long remaining = Math.max(1, Duration.between(now, deadline).toMillis());
            long sleep = Math.min(remaining, config.pollInterval().toMillis());
            Thread.sleep(Math.max(1, sleep));
        }
    }

    public void reply(
        HarnessClient harness,
        String sessionId,
        PendingQuestion question,
        String answer
    ) throws IOException {
        if ("doom_loop".equals(question.kind())) {
            // The doom-loop question is supervisor-side; OpenCode never blocked
            // on it, so there is nothing to resume.
            return;
        }
        harness.replyToQuestion(sessionId, question.externalId(), question.kind(), answer);
    }

    public void reject(
        HarnessClient harness,
        String sessionId,
        PendingQuestion question
    ) throws IOException {
        if ("doom_loop".equals(question.kind())) {
            return;
        }
        harness.rejectQuestion(sessionId, question.externalId(), question.kind());
    }

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
