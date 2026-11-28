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
            "1 file changed",
            List.of("filter works"),
            List.of("planning: filter scope"));
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
                assertTrue(prompt.contains("filter works"), prompt);
                assertTrue(prompt.contains("planning: filter scope"), prompt);
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
            "req-2", 99L, "feat/fix", SHA, 0, List.of(), null, List.of(), List.of(), null,
            List.of(), List.of());

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

    private FixTicketProcessor.Workspace workspace(FixCheckout checkout) {
        return new FixTicketProcessor.Workspace() {
            @Override
            public Path root() {
                return Path.of("/tmp/fix-workspace");
            }

            @Override
            public void checkout(String branch, String reviewedSha) throws IOException {
                checkout.run();
            }
        };
    }

    @FunctionalInterface
    private interface FixCheckout {
        void run() throws IOException;
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

    @Test
    void rejectsAMissingClaimAndAnInvalidSha() {
        FixTicketProcessor processor = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            journal(true),
            Duration.ofMinutes(30));

        assertEquals(FixTicketProcessor.Status.FAILED,
            processor.process(ticket(), null).status());

        FixTicketProcessor.FixClaim shortSha = new FixTicketProcessor.FixClaim(
            "req-3", 42L, "feat/fix", "abc", 0, List.of(), null,
            List.of(), List.of(), null, List.of(), List.of());
        FixTicketProcessor.Outcome outcome = processor.process(ticket(), shortSha);
        assertEquals(FixTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("invalid reviewed SHA"));
        assertTrue(events.isEmpty());
    }

    @Test
    void failsTheRunWhenTheWorkspaceOrHarnessFails() {
        FixTicketProcessor.Workspace failingCheckout = workspace(
            () -> { throw new IOException("clone failed"); });
        FixTicketProcessor.Outcome checkoutFailure = new FixTicketProcessor(
            failingCheckout,
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            journal(true),
            clock,
            Duration.ofMinutes(30)
        ).process(ticket(), claim());
        assertEquals(FixTicketProcessor.Status.FAILED, checkoutFailure.status());
        assertTrue(checkoutFailure.reason().contains("clone failed"));
        assertTrue(events.contains("finishRun run-1 false fix run failed: clone failed"));

        events.clear();
        FixTicketProcessor.Outcome harnessFailure = processor(
            (workspace, title, prompt) -> { throw new IOException("model down"); },
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());
        assertEquals(FixTicketProcessor.Status.FAILED, harnessFailure.status());
        assertTrue(harnessFailure.reason().contains("model down"));
    }

    @Test
    void failsWhenTheRunCannotStart() {
        FixTicketProcessor.Journal broken = new FixTicketProcessor.Journal() {
            @Override
            public boolean renew() {
                return true;
            }

            @Override
            public String startRun(FixTicketProcessor.FixClaim claim) throws IOException {
                throw new IOException("run rejected");
            }

            @Override
            public void finishRun(String runId, boolean succeeded, String error) {
                events.add("finishRun");
            }
        };

        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            broken,
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.FAILED, outcome.status());
        assertTrue(outcome.reason().contains("run rejected"));
        assertFalse(events.contains("finishRun"), "no run id means no finish call");
    }

    @Test
    void stopsAtTheDeadlineBeforePromptingOrVerifying() {
        FixTicketProcessor.Outcome beforePrompt = new FixTicketProcessor(
            workspace(() -> clock.advance(Duration.ofMinutes(31))),
            (workspace, title, prompt) -> events.add("fix"),
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            journal(true),
            clock,
            Duration.ofMinutes(30)
        ).process(ticket(), claim());
        assertEquals(FixTicketProcessor.Status.FAILED, beforePrompt.status());
        assertTrue(beforePrompt.reason().contains("before prompting"));
        assertFalse(events.contains("fix"));

        events.clear();
        FixTicketProcessor.Outcome beforeVerify = processor(
            (workspace, title, prompt) -> clock.advance(Duration.ofMinutes(31)),
            (workspace, timeout) -> {
                events.add("verify");
                return true;
            },
            (message, claim) -> SHA,
            journal(true),
            Duration.ofMinutes(30)
        ).process(ticket(), claim());
        assertEquals(FixTicketProcessor.Status.FAILED, beforeVerify.status());
        assertTrue(beforeVerify.reason().contains("before verification"));
        assertFalse(events.contains("verify"));
    }

    @Test
    void doesNotDowngradeAPublishedRunWhenBookkeepingFails() {
        int[] successes = {0};
        FixTicketProcessor.Journal flaky = new FixTicketProcessor.Journal() {
            @Override
            public boolean renew() {
                return true;
            }

            @Override
            public String startRun(FixTicketProcessor.FixClaim claim) {
                return "run-1";
            }

            @Override
            public void finishRun(String runId, boolean succeeded, String error) throws IOException {
                if (succeeded) {
                    successes[0]++;
                    if (successes[0] == 1) {
                        throw new IOException("backend hiccup");
                    }
                    events.add("finishRun succeeded");
                    return;
                }
                events.add("finishRun failed");
            }
        };

        FixTicketProcessor.Outcome outcome = processor(
            (workspace, title, prompt) -> { },
            (workspace, timeout) -> true,
            (message, claim) -> SHA,
            flaky,
            Duration.ofMinutes(30)
        ).process(ticket(), claim());

        assertEquals(FixTicketProcessor.Status.DONE, outcome.status());
        assertEquals(2, successes[0], "the success finish is retried once");
        assertTrue(events.contains("finishRun succeeded"));
        assertFalse(events.contains("finishRun failed"), "a published run is never failed");
    }
}
