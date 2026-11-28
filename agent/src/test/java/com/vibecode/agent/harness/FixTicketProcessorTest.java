package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FixTicketProcessorTest {

    private static final String SHA = "a".repeat(40);

    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-28T10:00:00Z"));
    private final List<String> events = new ArrayList<>();

    private Ticket ticket() {
        Ticket ticket = new Ticket();
        ticket.setId(42L);
        ticket.setTitle("Add filter");
        return ticket;
    }

    private FixTicketProcessor.FixClaim claim() {
        return new FixTicketProcessor.FixClaim(
            "req-1", 42L, "feat/fix", SHA, 1,
            List.of(new PromptBuilder.FixFinding("F1", "critical", "App.js", 4, "Dropped scope", null)),
            "please fix",
            List.of("npm test"),
            List.of("npm test failed"),
            "1 file changed");
    }

    private FixTicketProcessor processor(
        FixTicketProcessor.Harness harness,
        FixTicketProcessor.Verification verification,
        FixTicketProcessor.Publisher publisher,
        FixTicketProcessor.Journal journal,
        Duration budget
    ) {
        return new FixTicketProcessor(
            new FixTicketProcessor.Workspace() {
                @Override
                public Path root() {
                    return Path.of("/tmp/fix-workspace");
                }

                @Override
                public void checkout(String branch, String reviewedSha) {
                    events.add("checkout " + branch + " " + reviewedSha);
                }
            },
            harness,
            verification,
            publisher,
            journal,
            clock,
            budget
        );
    }

    private FixTicketProcessor.Journal journal(boolean renew) {
        return new FixTicketProcessor.Journal() {
            @Override
            public boolean renew() {
                events.add("renew");
                return renew;
            }

            @Override
            public String startRun(FixTicketProcessor.FixClaim claim) {
                events.add("startRun");
                return "run-1";
            }

            @Override
            public void finishRun(String runId, boolean succeeded, String error) {
                events.add("finishRun " + runId + " " + succeeded + " " + error);
            }
        };
    }

    @Test
    void runsTheFixLifecycleInOrder() {
        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> {
                events.add("fix");
                assertTrue(prompt.contains("id=F1"), prompt);
                assertTrue(prompt.contains("please fix"), prompt);
            },
            (workspace, timeout) -> {
                events.add("verify");
                return true;
            },
            (message, claim) -> {
                events.add("publish");
                assertTrue(message.startsWith("fix(#42)"), message);
                return SHA;
            },
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.DONE, outcome.status());
        assertEquals(SHA, outcome.headSha());
        assertEquals(List.of(
            "renew", "startRun", "checkout feat/fix " + SHA, "fix",
            "renew", "verify", "renew", "publish", "finishRun run-1 true null"
        ), events);
    }

    @Test
    void rejectsAClaimForAnotherTicket() {
        FixTicketProcessor.FixClaim other = new FixTicketProcessor.FixClaim(
            "req-2", 99L, "feat/fix", SHA, 0, List.of(), null, List.of(), List.of(), null);

        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), other);

        assertEquals(FixTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("does not belong"));
        assertTrue(events.isEmpty());
    }

    @Test
    void skipsWhenTheLeaseIsLostBeforeTheRunStarts() {
        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            journal(false),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.SKIPPED, outcome.status());
        assertTrue(outcome.reason().contains("fix_lease_lost"));
        assertEquals(List.of("renew"), events);
    }

    @Test
    void stopsBeforePublishingWhenTheLeaseIsLost() {
        int[] renews = {0};
        FixTicketProcessor.Journal journal = new FixTicketProcessor.Journal() {
            @Override
            public boolean renew() {
                renews[0]++;
                events.add("renew");
                return renews[0] < 3;
            }

            @Override
            public String startRun(FixTicketProcessor.FixClaim claim) {
                events.add("startRun");
                return "run-1";
            }

            @Override
            public void finishRun(String runId, boolean succeeded, String error) {
                events.add("finishRun " + succeeded + " " + error);
            }
        };

        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> {
                events.add("verify");
                return true;
            },
            (message, claim) -> {
                events.add("publish");
                return SHA;
            },
            journal,
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("before publishing"));
        assertFalse(events.contains("publish"));
        assertTrue(events.contains("finishRun false fix_lease_lost before publishing"));
    }

    @Test
    void failsTheRunWhenVerificationFails() {
        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> {
                events.add("verify");
                return false;
            },
            (message, claim) -> {
                events.add("publish");
                return SHA;
            },
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("verification failed"));
        assertFalse(events.contains("publish"));
    }

    @Test
    void reportsAPublishRejectionWithoutRetrying() {
        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> {
                events.add("publish");
                throw new IOException("remote_head_moved: moved");
            },
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("remote_head_moved"));
        assertEquals(1, events.stream().filter("publish"::equals).count());
        assertTrue(events.contains("finishRun run-1 false fix run failed: remote_head_moved: moved"));
    }

    @Test
    void ignoresTheDeadlineOncePublishingHasStarted() {
        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> {
                events.add("verify");
                clock.advance(Duration.ofHours(2));
                return true;
            },
            (message, claim) -> {
                events.add("publish");
                return SHA;
            },
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.DONE, outcome.status());
        assertTrue(events.contains("publish"));
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
