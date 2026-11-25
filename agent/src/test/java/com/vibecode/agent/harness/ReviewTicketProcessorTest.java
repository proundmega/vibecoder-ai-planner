package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.vibecode.agent.model.Ticket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewTicketProcessorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String SHA = "a".repeat(40);

    @TempDir
    Path workspace;

    @Test
    void skipsTicketsThatAreNotInReview() {
        FakeHarness harness = new FakeHarness(approveJson());
        AtomicBoolean opened = new AtomicBoolean();
        ReviewTicketProcessor processor = processor(
            harness, opened, ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(
            job(ticket("in_progress", "https://github.com/example/repo/pull/7"), SHA));

        assertEquals(ReviewTicketProcessor.Status.SKIPPED, outcome.status());
        assertTrue(outcome.reason().contains("not review"));
        assertFalse(opened.get());
    }

    @Test
    void skipsTicketsWithoutAPullRequest() {
        ReviewTicketProcessor processor = processor(
            new FakeHarness(approveJson()), new AtomicBoolean(),
            ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(
            job(ticket("review", null), SHA));

        assertEquals(ReviewTicketProcessor.Status.SKIPPED, outcome.status());
        assertTrue(outcome.reason().contains("pr_url"));
    }

    @Test
    void skipsACompletedReviewForTheSameSha() {
        AtomicBoolean opened = new AtomicBoolean();
        ReviewTicketProcessor processor = processor(
            new FakeHarness(approveJson()), opened,
            (ticketId, reviewedSha) -> true, passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(job(reviewTicket(), SHA));

        assertEquals(ReviewTicketProcessor.Status.SKIPPED, outcome.status());
        assertTrue(outcome.reason().contains("already completed"));
        assertFalse(opened.get());
    }

    @Test
    void failsOnInvalidShaOrMissingWorkspace() {
        ReviewTicketProcessor processor = processor(
            new FakeHarness(approveJson()), new AtomicBoolean(),
            ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome badSha = processor.process(job(reviewTicket(), "abc1234"));
        assertEquals(ReviewTicketProcessor.Status.FAILED, badSha.status());
        assertTrue(badSha.reason().contains("40 or 64"));

        ReviewTicketProcessor.Job missingWorkspace = new ReviewTicketProcessor.Job(
            reviewTicket(), promptRequest(), workspace.resolve("missing"), SHA);
        ReviewTicketProcessor.Outcome missing = processor.process(missingWorkspace);
        assertEquals(ReviewTicketProcessor.Status.FAILED, missing.status());
        assertTrue(missing.reason().contains("workspace"));
    }

    @Test
    void failsClosedWhenVerificationCannotRun() {
        AtomicBoolean opened = new AtomicBoolean();
        ReviewTicketProcessor processor = processor(
            new FakeHarness(approveJson()), opened, ReviewTicketProcessor.AttemptGate.none(),
            ignored -> {
                throw new IOException("verification explosion");
            });

        ReviewTicketProcessor.Outcome outcome = processor.process(job(reviewTicket(), SHA));

        assertEquals(ReviewTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("verification failed to run"));
        assertFalse(opened.get());
    }

    @Test
    void failsClosedWhenTheHarnessFails() {
        FakeHarness harness = new FakeHarness(approveJson());
        harness.failStart = true;
        ReviewTicketProcessor processor = processor(
            harness, new AtomicBoolean(), ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(job(reviewTicket(), SHA));

        assertEquals(ReviewTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("review harness failed"));
        assertTrue(harness.closed);
    }

    @Test
    void failsClosedOnMalformedModelOutput() {
        ReviewTicketProcessor processor = processor(
            new FakeHarness("I cannot approve this."),
            new AtomicBoolean(), ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(job(reviewTicket(), SHA));

        assertEquals(ReviewTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("invalid review output"));
    }

    @Test
    void completesAnApproveWhenVerificationPasses() {
        ReviewTicketProcessor processor = processor(
            new FakeHarness(approveJson()), new AtomicBoolean(),
            ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(
            job(reviewTicket(), SHA.toUpperCase()));

        assertEquals(ReviewTicketProcessor.Status.COMPLETED, outcome.status());
        assertEquals(SHA, outcome.reviewedSha());
        assertEquals("approve", outcome.result().verdict());
        assertTrue(outcome.approved());
        assertEquals(1, outcome.verification().size());
        assertNull(outcome.reason());
    }

    @Test
    void downgradesApproveWhenVerificationFailsOrIsEmpty() {
        ReviewTicketProcessor failed = processor(
            new FakeHarness(approveJson()), new AtomicBoolean(),
            ReviewTicketProcessor.AttemptGate.none(), ignored -> List.of(
                new VerificationResult("npm test", 1, "failure", false)));

        ReviewTicketProcessor.Outcome failedOutcome = failed.process(job(reviewTicket(), SHA));
        assertEquals(ReviewTicketProcessor.Status.COMPLETED, failedOutcome.status());
        assertEquals("comment", failedOutcome.result().verdict());
        assertFalse(failedOutcome.approved());
        assertTrue(failedOutcome.result().summary().contains("verification did not pass"));

        ReviewTicketProcessor empty = processor(
            new FakeHarness(approveJson()), new AtomicBoolean(),
            ReviewTicketProcessor.AttemptGate.none(), ignored -> List.of());

        ReviewTicketProcessor.Outcome emptyOutcome = empty.process(job(reviewTicket(), SHA));
        assertEquals("comment", emptyOutcome.result().verdict());
        assertFalse(emptyOutcome.approved());
    }

    @Test
    void downgradesApproveWithCriticalFindings() {
        String text = """
            {"verdict": "approve", "summary": "ok", "findings": [
              {"severity": "critical", "file": "backend/src/App.js", "line": 4,
               "message": "This path drops the error."}]}
            """;
        ReviewTicketProcessor processor = processor(
            new FakeHarness(text), new AtomicBoolean(),
            ReviewTicketProcessor.AttemptGate.none(), passingVerification());

        ReviewTicketProcessor.Outcome outcome = processor.process(job(reviewTicket(), SHA));

        assertEquals("request_changes", outcome.result().verdict());
        assertFalse(outcome.approved());
        assertTrue(outcome.result().summary().contains("critical findings"));
        assertEquals(1, outcome.result().findings().size());
    }

    private ReviewTicketProcessor processor(
        FakeHarness harness,
        AtomicBoolean opened,
        ReviewTicketProcessor.AttemptGate gate,
        ReviewTicketProcessor.Verification verification
    ) {
        return new ReviewTicketProcessor(
            new ReviewPromptBuilder(),
            new ReviewResultParser(),
            gate,
            verification,
            () -> {
                opened.set(true);
                return new ReviewHarnessClient(harness);
            }
        );
    }

    private static ReviewTicketProcessor.Verification passingVerification() {
        return ignored -> List.of(new VerificationResult("npm test", 0, "ok", false));
    }

    private ReviewTicketProcessor.Job job(Ticket ticket, String sha) {
        return new ReviewTicketProcessor.Job(ticket, promptRequest(), workspace, sha);
    }

    private static Ticket reviewTicket() {
        return ticket("review", "https://github.com/example/repo/pull/77");
    }

    private static Ticket ticket(String status, String prUrl) {
        Ticket ticket = new Ticket();
        ticket.setId(42L);
        ticket.setTitle("Add ticket filtering");
        ticket.setDescription("Filter tickets by status.");
        ticket.setStatus(status);
        ticket.setPriority("high");
        ticket.setPrUrl(prUrl);
        return ticket;
    }

    private static ReviewPromptBuilder.Request promptRequest() {
        return new ReviewPromptBuilder.Request(
            reviewTicket(),
            "review",
            List.of(),
            List.of(),
            List.of(),
            new ReviewPromptBuilder.PullRequest(
                "77",
                "https://github.com/example/repo/pull/77",
                "master",
                "feat/filtering",
                SHA,
                List.of(new ReviewPromptBuilder.ChangedFile("backend/src/App.js", "modified")),
                "diff --git a/backend/src/App.js b/backend/src/App.js"
            ),
            0,
            List.of()
        );
    }

    private static String approveJson() {
        return "{\"verdict\":\"approve\",\"summary\":\"Looks good.\",\"findings\":[]}";
    }

    private static final class FakeHarness implements HarnessClient {

        private final String text;
        private Consumer<HarnessEvent> listener;
        private boolean failStart;
        private boolean healthy = true;
        private boolean closed;

        private FakeHarness(String text) {
            this.text = text;
        }

        @Override
        public void start(Path workspace) throws IOException {
            if (failStart) {
                throw new IOException("cannot start harness");
            }
        }

        @Override
        public String createSession(String title) {
            return "ses_test";
        }

        @Override
        public void sendPrompt(String sessionId, String prompt) {
            ObjectNode payload = MAPPER.createObjectNode();
            payload.put("type", "message.part.updated");
            ObjectNode part = payload.putObject("properties").putObject("part");
            part.put("id", "p1");
            part.put("messageID", "msg_1");
            part.put("type", "text");
            part.put("text", text);
            listener.accept(HarnessEvent.of("message.part.updated", payload));
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
