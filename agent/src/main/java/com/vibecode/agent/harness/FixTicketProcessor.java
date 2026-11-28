package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Supervises one fix run (fg-32c2c3b3, FR5/FR6/FR7).
 *
 * <p>The processor starts from an already-claimed fix request and never claims
 * one itself. It checks out the existing PR branch pinned at
 * {@code reviewedSha}, starts one fixer harness run, prompts the model with the
 * structured findings, runs verification, then publishes with fast-forward
 * semantics only. A lost lease or an expired budget stops the run before
 * publishing; once publishing has begun the deadline is ignored.</p>
 *
 * <p>All side effects go through the injected seams so the lifecycle can be
 * tested without a workspace, a model or a backend.</p>
 */
public final class FixTicketProcessor {

    private final Workspace workspace;
    private final Harness harness;
    private final Verification verification;
    private final Publisher publisher;
    private final Journal journal;
    private final Clock clock;
    private final Duration budget;
    private final PromptBuilder prompts;

    public FixTicketProcessor(
        Workspace workspace,
        Harness harness,
        Verification verification,
        Publisher publisher,
        Journal journal,
        Clock clock,
        Duration budget
    ) {
        this(workspace, new PromptBuilder(), harness, verification, publisher, journal, clock, budget);
    }

    FixTicketProcessor(
        Workspace workspace,
        PromptBuilder prompts,
        Harness harness,
        Verification verification,
        Publisher publisher,
        Journal journal,
        Clock clock,
        Duration budget
    ) {
        if (workspace == null || harness == null || verification == null
            || publisher == null || journal == null || clock == null) {
            throw new IllegalArgumentException("fix processor dependencies are required");
        }
        if (budget == null || budget.isZero() || budget.isNegative()) {
            throw new IllegalArgumentException("fix budget must be positive");
        }
        this.workspace = workspace;
        this.prompts = prompts == null ? new PromptBuilder() : prompts;
        this.harness = harness;
        this.verification = verification;
        this.publisher = publisher;
        this.journal = journal;
        this.clock = clock;
        this.budget = budget;
    }

    public Outcome process(Ticket ticket, FixClaim claim) {
        long startedAt = System.currentTimeMillis();
        if (ticket == null || claim == null) {
            return Outcome.failed("fix job and claim are required", startedAt);
        }
        if (isBlank(claim.requestId()) || claim.ticketId() != ticket.getId()) {
            return Outcome.failed("fix claim does not belong to this ticket", startedAt);
        }
        if (isBlank(claim.branch()) || isBlank(claim.reviewedSha())) {
            return Outcome.failed("fix claim has no branch or reviewed SHA", startedAt);
        }

        String runId = null;
        try {
            // A claim can expire between claimFix and the first step.
            if (!journal.renew()) {
                return Outcome.skipped("fix_lease_lost before start", startedAt);
            }
            runId = journal.startRun(claim);
            Instant deadline = clock.instant().plus(budget);

            workspace.checkout(claim.branch(), claim.reviewedSha());

            String prompt = prompts.buildFix(new PromptBuilder.FixContext(
                ticket,
                List.of(),
                List.of(),
                claim.round(),
                claim.reviewedSha(),
                claim.findings(),
                claim.feedback(),
                claim.previousVerification(),
                claim.previousDiffSummary(),
                claim.verificationCommands()
            ));

            if (expired(deadline)) {
                return failRun(runId, "fix_timeout before prompting", startedAt);
            }
            harness.fix(workspace.root(), sessionTitle(ticket, claim), prompt);

            if (!journal.renew()) {
                return failRun(runId, "fix_lease_lost before verification", startedAt);
            }
            if (expired(deadline)) {
                return failRun(runId, "fix_timeout before verification", startedAt);
            }
            if (!verification.verify(workspace.root(), remaining(deadline))) {
                return failRun(runId, "verification failed", startedAt);
            }

            if (!journal.renew()) {
                return failRun(runId, "fix_lease_lost before publishing", startedAt);
            }
            // Once publishing starts the deadline is ignored: interrupting a
            // push would leave the remote ambiguous.
            String headSha = publisher.publish(commitMessage(ticket, claim), claim);
            journal.finishRun(runId, true, null);
            return Outcome.done(headSha, elapsed(startedAt));
        } catch (IOException | RuntimeException error) {
            return failRun(runId, "fix run failed: " + safe(error), startedAt);
        }
    }

    private Outcome failRun(String runId, String reason, long startedAt) {
        if (runId != null) {
            try {
                journal.finishRun(runId, false, reason);
            } catch (IOException | RuntimeException finishError) {
                reason = reason + "; finishRun failed: " + safe(finishError);
            }
        }
        return Outcome.failed(reason, elapsed(startedAt));
    }

    private boolean expired(Instant deadline) {
        return !clock.instant().isBefore(deadline);
    }

    private Duration remaining(Instant deadline) {
        Duration left = Duration.between(clock.instant(), deadline);
        return left.isNegative() ? Duration.ZERO : left;
    }

    private String sessionTitle(Ticket ticket, FixClaim claim) {
        return "fix-" + ticket.getId() + "-" + claim.reviewedSha().substring(0, 7);
    }

    private String commitMessage(Ticket ticket, FixClaim claim) {
        String title = ticket.getTitle() == null ? "ticket" : ticket.getTitle().trim();
        return "fix(#" + ticket.getId() + "): address review feedback for " + title;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String safe(Throwable error) {
        if (error == null) {
            return "unknown error";
        }
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private static long elapsed(long startedAt) {
        return Math.max(0, System.currentTimeMillis() - startedAt);
    }

    /** The claimed fix request, as returned by the backend queue. */
    public record FixClaim(
        String requestId,
        long ticketId,
        String branch,
        String reviewedSha,
        int round,
        List<PromptBuilder.FixFinding> findings,
        String feedback,
        List<String> verificationCommands,
        List<String> previousVerification,
        String previousDiffSummary
    ) {
        public FixClaim {
            findings = findings == null ? List.of() : List.copyOf(findings);
            verificationCommands = verificationCommands == null
                ? List.of() : List.copyOf(verificationCommands);
            previousVerification = previousVerification == null
                ? List.of() : List.copyOf(previousVerification);
        }
    }

    public enum Status {
        DONE,
        SKIPPED,
        FAILED
    }

    public record Outcome(Status status, String reason, String headSha, long durationMs) {
        static Outcome done(String headSha, long durationMs) {
            return new Outcome(Status.DONE, null, headSha, durationMs);
        }

        static Outcome skipped(String reason, long startedAt) {
            return new Outcome(Status.SKIPPED, reason, null, elapsed(startedAt));
        }

        static Outcome failed(String reason, long startedAt) {
            return new Outcome(Status.FAILED, reason, null, elapsed(startedAt));
        }
    }

    public interface Workspace {
        Path root();

        void checkout(String branch, String reviewedSha) throws IOException;
    }

    @FunctionalInterface
    public interface Harness {
        void fix(Path workspace, String sessionTitle, String prompt) throws IOException;
    }

    @FunctionalInterface
    public interface Verification {
        /** @return true when every verification command passed */
        boolean verify(Path workspace, Duration timeout) throws IOException;
    }

    @FunctionalInterface
    public interface Publisher {
        /** Stage, commit and fast-forward publish; returns the published SHA. */
        String publish(String commitMessage, FixClaim claim) throws IOException;
    }

    /** Run lifecycle and lease heartbeat, backed by the backend. */
    public interface Journal {
        boolean renew() throws IOException;

        String startRun(FixClaim claim) throws IOException;

        void finishRun(String runId, boolean succeeded, String error) throws IOException;
    }
}
