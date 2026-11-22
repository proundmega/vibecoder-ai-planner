package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Fake-server question → answer → resume and timeout coverage (fg-55 FR2-FR4).
 */
class QuestionBridgeTest {

    private static final String RUN_ID = "11111111-1111-4111-8111-111111111111";

    private static final class FakeTransport implements QuestionBridge.Transport {
        long nextId = 7;
        String createdPrompt;
        String createdExternalId;
        String createdKind;
        final Deque<Map<String, Object>> responses = new ArrayDeque<>();
        boolean expired;

        @Override
        public long createHarnessQuestion(
            String runId,
            String externalId,
            String kind,
            String prompt,
            JsonNode options,
            Instant expiresAt
        ) {
            createdExternalId = externalId;
            createdKind = kind;
            createdPrompt = prompt;
            return nextId;
        }

        @Override
        public Map<String, Object> getHarnessQuestion(String runId, long questionId) {
            if (responses.isEmpty()) {
                return Map.of("status", "pending");
            }
            return responses.removeFirst();
        }

        @Override
        public void expireHarnessQuestion(String runId, long questionId) {
            expired = true;
        }
    }

    private static final class FakeHarness implements HarnessClient {
        String replySession;
        String replyId;
        String replyKind;
        String replyAnswer;
        String rejectId;

        @Override
        public void start(Path workspace) {
        }

        @Override
        public String createSession(String title) {
            return "ses_test";
        }

        @Override
        public void sendPrompt(String sessionId, String prompt) {
        }

        @Override
        public DiffSummary getDiff(String sessionId) {
            return DiffSummary.empty();
        }

        @Override
        public boolean isHealthy() {
            return true;
        }

        @Override
        public void close() {
        }

        @Override
        public void replyToQuestion(String sessionId, String requestId, String kind, String answer) {
            replySession = sessionId;
            replyId = requestId;
            replyKind = kind;
            replyAnswer = answer;
        }

        @Override
        public void rejectQuestion(String sessionId, String requestId, String kind) {
            rejectId = requestId;
        }
    }

    private HarnessConfig.QuestionLoopConfig config(long timeoutMs) {
        return new HarnessConfig.QuestionLoopConfig(
            true, Duration.ofMillis(timeoutMs), Duration.ofMillis(5), 3, 3);
    }

    @Test
    void createsAPendingQuestionAndWaitsForTheAnswer() throws Exception {
        FakeTransport transport = new FakeTransport();
        transport.responses.add(Map.of("status", "pending"));
        transport.responses.add(Map.of("status", "answered", "answer", "Use the helper."));
        QuestionBridge bridge = new QuestionBridge(transport, RUN_ID, config(2000));

        QuestionBridge.PendingQuestion pending = bridge.ask(
            "question", "evt_1", "Which helper?", null);
        QuestionBridge.Answer answer = bridge.waitForAnswer(pending);

        assertTrue(answer.answered());
        assertEquals("Use the helper.", answer.text());
        assertEquals("evt_1", transport.createdExternalId);
        assertEquals("question", transport.createdKind);
        assertEquals("Which helper?", transport.createdPrompt);
    }

    @Test
    void resumesOpenCodeOnAAnsweredQuestion() throws Exception {
        FakeTransport transport = new FakeTransport();
        transport.responses.add(Map.of("status", "answered", "answer", "yes"));
        QuestionBridge bridge = new QuestionBridge(transport, RUN_ID, config(2000));
        FakeHarness harness = new FakeHarness();

        QuestionBridge.PendingQuestion pending = bridge.ask("question", "evt_1", "ok?", null);
        QuestionBridge.Answer answer = bridge.waitForAnswer(pending);
        bridge.reply(harness, "ses_test", pending, answer.text());

        assertEquals("ses_test", harness.replySession);
        assertEquals("evt_1", harness.replyId);
        assertEquals("question", harness.replyKind);
        assertEquals("yes", harness.replyAnswer);
    }

    @Test
    void timesOutByExpiringTheQuestion() throws Exception {
        FakeTransport transport = new FakeTransport();
        QuestionBridge bridge = new QuestionBridge(transport, RUN_ID, config(30));

        QuestionBridge.PendingQuestion pending = bridge.ask("question", "evt_1", "ok?", null);
        QuestionBridge.Answer answer = bridge.waitForAnswer(pending);

        assertEquals("expired", answer.status());
        assertTrue(transport.expired);
    }

    @Test
    void defaultsExternalIdAndCapsThePrompt() throws Exception {
        FakeTransport transport = new FakeTransport();
        QuestionBridge bridge = new QuestionBridge(transport, RUN_ID, config(2000));
        String prompt = "x".repeat(9000);

        bridge.ask("doom_loop", null, prompt, null);

        assertTrue(transport.createdExternalId.startsWith("evt-"));
        assertEquals(8192, transport.createdPrompt.length());
    }

    @Test
    void rejectForwardsToOpenCodeButDoomLoopIsSupervisorSide() throws Exception {
        FakeTransport transport = new FakeTransport();
        QuestionBridge bridge = new QuestionBridge(transport, RUN_ID, config(2000));
        FakeHarness harness = new FakeHarness();

        QuestionBridge.PendingQuestion question =
            bridge.ask("question", "evt_1", "ok?", null);
        bridge.reject(harness, "ses_test", question);
        assertEquals("evt_1", harness.rejectId);

        QuestionBridge.PendingQuestion doom =
            bridge.ask("doom_loop", "doom-1", "loop", null);
        harness.rejectId = null;
        bridge.reject(harness, "ses_test", doom);
        assertEquals(null, harness.rejectId);
    }

    @Test
    void keepsPollingUntilTheTimeoutDeadline() throws Exception {
        FakeTransport transport = new FakeTransport();
        for (int i = 0; i < 3; i++) {
            transport.responses.add(new HashMap<>(Map.of("status", "pending")));
        }
        QuestionBridge bridge = new QuestionBridge(transport, RUN_ID, config(40));

        long start = System.nanoTime();
        QuestionBridge.PendingQuestion pending = bridge.ask("question", "evt_1", "ok?", null);
        QuestionBridge.Answer answer = bridge.waitForAnswer(pending);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;

        assertEquals("expired", answer.status());
        assertTrue(elapsedMs >= 30, "expected a bounded wait, got " + elapsedMs + "ms");
        List<Map<String, Object>> unused = new ArrayList<>(transport.responses);
        assertTrue(unused.size() <= 3);
    }
}
