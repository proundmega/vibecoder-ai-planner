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
        long startedAt = clock.millis();
        if (ticket == null || claim == null) {
            return Outcome.failed("fix job and claim are required", elapsed(startedAt));
        }
        if (isBlank(claim.requestId()) || claim.ticketId() != ticket.getId()) {
            return Outcome.failed("fix claim does not belong to this ticket", elapsed(startedAt));
        }
        if (isBlank(claim.branch()) || isBlank(claim.reviewedSha())) {
            return Outcome.failed("fix claim has no branch or reviewed SHA", elapsed(startedAt));
        }
        if (!claim.reviewedSha().matches("^[0-9a-f]{40}([0-9a-f]{24})?$")) {
            return Outcome.failed("fix claim has an invalid reviewed SHA", elapsed(startedAt));
        }

        String runId = null;
        boolean published = false;
        String headSha = null;
        try {
            // A claim can expire between claimFix and the first step.
            if (!journal.renew()) {
                return Outcome.skipped("fix_lease_lost before start", elapsed(startedAt));
            }
            String startedRunId = journal.startRun(claim);
            if (isBlank(startedRunId)) {
                throw new IOException("fix run start returned no run id");
            }
            runId = startedRunId;
            Instant deadline = clock.instant().plus(budget);

            workspace.checkout(claim.branch(), claim.reviewedSha());

            String prompt = prompts.buildFix(new PromptBuilder.FixContext(
                ticket,
                claim.acceptanceCriteria(),
                claim.planningDocs(),
                claim.round(),
                claim.reviewedSha(),
                claim.findings(),
                claim.feedback(),
                claim.previousVerification(),
                claim.previousDiffSummary(),
                claim.verificationCommands()
            ));

            if (expired(deadline)) {
                return failRun(runId, "fix_timeout before prompting", elapsed(startedAt));
            }
            harness.fix(workspace.root(), sessionTitle(ticket, claim), prompt);

            if (!journal.renew()) {
                return failRun(runId, "fix_lease_lost before verification", elapsed(startedAt));
            }
            if (expired(deadline)) {
                return failRun(runId, "fix_timeout before verification", elapsed(startedAt));
            }
            if (!verification.verify(workspace.root(), remaining(deadline))) {
                return failRun(runId, "verification failed", elapsed(startedAt));
            }

            if (!journal.renew()) {
                return failRun(runId, "fix_lease_lost before publishing", elapsed(startedAt));
            }
            // Once publishing starts the deadline is ignored: interrupting a
            // push would leave the remote ambiguous.
            headSha = publisher.publish(commitMessage(ticket, claim), claim);
            if (isBlank(headSha)) {
                // The publisher contract is "a throw means not published", so
                // a blank SHA is not a publication either.
                throw new IOException("publish returned no head SHA");
            }
            published = true;
            String finishError = finishSucceeded(runId);
            return Outcome.done(headSha, elapsed(startedAt), finishError);
        } catch (IOException | RuntimeException error) {
            if (published) {
                // The commit is on the remote: never downgrade it to a failed
                // run. Retry the success bookkeeping and report DONE.
                String finishError = finishSucceeded(runId);
                return Outcome.done(headSha, elapsed(startedAt),
                    "published but " + safe(error)
                        + (finishError == null ? "" : "; " + finishError));
            }
            return failRun(runId, "fix run failed: " + safe(error), elapsed(startedAt));
        }
    }

    /**
     * Mark the run succeeded, retrying once because fg-33 finish is
     * idempotent. Returns null on success or a reason for the caller.
     */
    private String finishSucceeded(String runId) {
        if (runId == null) {
            return "finishRun skipped: no run id";
        }
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                journal.finishRun(runId, true, null);
                return null;
            } catch (IOException | RuntimeException error) {
                if (attempt == 2) {
                    return "finishRun(succeeded) failed: " + safe(error);
                }
            }
        }
        return null;
    }

    private Outcome failRun(String runId, String reason, long durationMs) {
        if (runId != null) {
            try {
                journal.finishRun(runId, false, reason);
            } catch (IOException | RuntimeException finishError) {
                reason = reason + "; finishRun failed: " + safe(finishError);
            }
        }
        return Outcome.failed(reason, durationMs);
    }

    private boolean expired(Instant deadline) {
        return !clock.instant().isBefore(deadline);
    }

    private Duration remaining(Instant deadline) {
        Duration left = Duration.between(clock.instant(), deadline);
        return left.isNegative() ? Duration.ZERO : left;
    }

    private String sessionTitle(Ticket ticket, FixClaim claim) {
        String sha = claim.reviewedSha();
        return "fix-" + ticket.getId() + "-" + sha.substring(0, Math.min(7, sha.length()));
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

    private long elapsed(long startedAt) {
        return Math.max(0, clock.millis() - startedAt);
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
        String previousDiffSummary,
        List<String> acceptanceCriteria,
        List<String> planningDocs
    ) {
        public FixClaim {
            findings = findings == null ? List.of() : List.copyOf(findings);
            acceptanceCriteria = acceptanceCriteria == null
                ? List.of() : List.copyOf(acceptanceCriteria);
            planningDocs = planningDocs == null ? List.of() : List.copyOf(planningDocs);
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

    /**
     * Result of one fix attempt.
     *
     * <p>Consumers must key off {@link #status()}: for {@link Status#DONE}
     * {@link #reason()} carries a <em>warning</em> (the published commit is
     * fine, but bookkeeping needs a retry), while for
     * {@link Status#FAILED}/{@link Status#SKIPPED} it carries the failure or
     * skip cause. A non-null reason on {@code DONE} means the next slice must
     * retry the completion call ({@code completeFix}) even though the run is
     * already successful.</p>
     */
    public record Outcome(Status status, String reason, String headSha, long durationMs) {
        static Outcome done(String headSha, long durationMs, String warning) {
            return new Outcome(Status.DONE, warning, headSha, durationMs);
        }

        static Outcome skipped(String reason, long durationMs) {
            return new Outcome(Status.SKIPPED, reason, null, durationMs);
        }

        static Outcome failed(String reason, long durationMs) {
            return new Outcome(Status.FAILED, reason, null, durationMs);
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
        /**
         * Stage, commit and fast-forward publish; returns the published SHA,
         * which must be non-blank.
         *
         * <p>Contract: <strong>a throw means "not published"</strong>. An
         * implementation that cannot tell whether the push landed must check
         * the remote and return the SHA when it did, so the processor never
         * reports a live commit as a failed run. A blank return is treated as
         * not published.</p>
         */
        String publish(String commitMessage, FixClaim claim) throws IOException;
    }

    /** Run lifecycle and lease heartbeat, backed by the backend. */
    public interface Journal {
        boolean renew() throws IOException;

        String startRun(FixClaim claim) throws IOException;

        void finishRun(String runId, boolean succeeded, String error) throws IOException;
    }
}
