package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.model.Ticket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewHarnessClientTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path workspace;

    @Test
    void runsReviewAndReturnsAssistantText() throws Exception {
        FakeHarness harness = new FakeHarness();
        harness.events.add(event(
            "{\"type\":\"message.updated\",\"properties\":"
                + "{\"info\":{\"id\":\"msg_1\",\"role\":\"assistant\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"prt_1\",\"messageID\":\"msg_1\","
                + "\"type\":\"text\",\"text\":\"Looks good.\"}}}"));

        String text;
        try (ReviewHarnessClient client = new ReviewHarnessClient(harness)) {
            text = client.review(workspace, "review-42", promptRequest());
        }

        assertEquals("Looks good.", text);
        assertEquals(workspace, harness.startedWorkspace);
        assertEquals("review-42", harness.sessionTitle);
        assertTrue(harness.prompt.contains("Add ticket filtering"));
        assertTrue(harness.closed);
    }

    @Test
    void picksTheLastAssistantMessageAndIgnoresUserText() throws Exception {
        FakeHarness harness = new FakeHarness();
        harness.events.add(event(
            "{\"type\":\"message.updated\",\"properties\":"
                + "{\"info\":{\"id\":\"msg_user\",\"role\":\"user\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"u1\",\"messageID\":\"msg_user\","
                + "\"type\":\"text\",\"text\":\"Please review this.\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.updated\",\"properties\":"
                + "{\"info\":{\"id\":\"msg_a1\",\"role\":\"assistant\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"a1\",\"messageID\":\"msg_a1\","
                + "\"type\":\"text\",\"text\":\"First draft.\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.updated\",\"properties\":"
                + "{\"info\":{\"id\":\"msg_a2\",\"role\":\"assistant\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"a2\",\"messageID\":\"msg_a2\","
                + "\"type\":\"text\",\"text\":\"Final review.\"}}}"));

        String text = new ReviewHarnessClient(harness).review(workspace, "review", promptRequest());

        assertEquals("Final review.", text);
    }

    @Test
    void usesTheLatestTextForAStreamedPart() throws Exception {
        FakeHarness harness = new FakeHarness();
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"p1\",\"messageID\":\"msg_1\","
                + "\"type\":\"text\",\"text\":\"{\\\"verdict\\\":\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"p1\",\"messageID\":\"msg_1\","
                + "\"type\":\"text\",\"text\":\"{\\\"verdict\\\":\\\"approve\\\"}\"}}}"));

        String text = new ReviewHarnessClient(harness).review(workspace, "review", promptRequest());

        assertEquals("{\"verdict\":\"approve\"}", text);
    }

    @Test
    void fallsBackToTheLastMessageWhenNoRoleIsPresent() throws Exception {
        FakeHarness harness = new FakeHarness();
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"p1\",\"messageID\":\"msg_1\","
                + "\"type\":\"text\",\"text\":\"old\"}}}"));
        harness.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"id\":\"p2\",\"messageID\":\"msg_2\","
                + "\"type\":\"text\",\"text\":\"new\"}}}"));

        String text = new ReviewHarnessClient(harness).review(workspace, "review", promptRequest());

        assertEquals("new", text);
    }

    @Test
    void failsClosedOnEmptyOrUnhealthyReview() throws Exception {
        FakeHarness empty = new FakeHarness();
        assertThrows(IOException.class,
            () -> new ReviewHarnessClient(empty).review(workspace, "review", promptRequest()));

        FakeHarness unhealthy = new FakeHarness();
        unhealthy.healthy = false;
        unhealthy.events.add(event(
            "{\"type\":\"message.part.updated\",\"properties\":"
                + "{\"part\":{\"type\":\"text\",\"text\":\"body\"}}}"));
        assertThrows(IOException.class,
            () -> new ReviewHarnessClient(unhealthy).review(workspace, "review", promptRequest()));
    }

    private static ReviewPromptBuilder.Request promptRequest() {
        Ticket ticket = new Ticket();
        ticket.setId(42L);
        ticket.setTitle("Add ticket filtering");
        ticket.setDescription("Filter tickets by status.");
        ticket.setStatus("review");
        return new ReviewPromptBuilder.Request(
            ticket,
            "review",
            List.of(),
            List.of(),
            List.of(),
            new ReviewPromptBuilder.PullRequest(
                "77",
                "https://github.com/example/repo/pull/77",
                "master",
                "feat/filtering",
                "a".repeat(40),
                List.of(new ReviewPromptBuilder.ChangedFile("backend/src/filter.js", "modified")),
                "diff --git a/backend/src/filter.js b/backend/src/filter.js"
            ),
            0,
            List.of()
        );
    }

    private static HarnessEvent event(String json) throws IOException {
        JsonNode payload = MAPPER.readTree(json);
        return HarnessEvent.of(payload.path("type").asText("event"), payload);
    }

    private static final class FakeHarness implements HarnessClient {

        private final List<HarnessEvent> events = new ArrayList<>();
        private Consumer<HarnessEvent> listener;
        private Path startedWorkspace;
        private String sessionTitle;
        private String prompt = "";
        private boolean healthy = true;
        private boolean closed;

        @Override
        public void start(Path workspace) {
            startedWorkspace = workspace;
        }

        @Override
        public String createSession(String title) {
            sessionTitle = title;
            return "ses_test";
        }

        @Override
        public void sendPrompt(String sessionId, String prompt) {
            this.prompt = prompt;
            for (HarnessEvent event : events) {
                listener.accept(event);
            }
        }

        @Override
        public void subscribe(String sessionId, Consumer<HarnessEvent> listener) {
            this.listener = listener;
        }

        @Override
        public DiffSummary getDiff(String sessionId) {
            return DiffSummary.empty();
        }

        @Override
        public boolean isHealthy() {
            return healthy;
        }

        @Override
        public void close() {
            closed = true;
        }
    }
}
