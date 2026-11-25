package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Supervises one review run (fg-31c, FR1/FR3/FR9).
 *
 * <p>The processor only starts when the ticket is in {@code review}, has a
 * {@code pr_url}, a valid 40/64-character head SHA and no completed attempt for
 * that SHA. The supervisor runs verification before the model; model output is
 * parsed strictly, and an {@code approve} is downgraded unless verification ran
 * at least one command and every command passed. Publishing, phase
 * reconciliation and the backend attempt writes are fg-31d.</p>
 */
public final class ReviewTicketProcessor {

    private static final SecretRedactor REDACTOR = SecretRedactor.patternsOnly();
    private static final Duration DEFAULT_VERIFICATION_TIMEOUT = Duration.ofMinutes(10);

    private final ReviewPromptBuilder promptBuilder;
    private final ReviewResultParser resultParser;
    private final AttemptGate attemptGate;
    private final Verification verification;
    private final HarnessFactory harnessFactory;

    public ReviewTicketProcessor(
        ReviewPromptBuilder promptBuilder,
        ReviewResultParser resultParser,
        AttemptGate attemptGate,
        Verification verification,
        HarnessFactory harnessFactory
    ) {
        this.promptBuilder = promptBuilder == null ? new ReviewPromptBuilder() : promptBuilder;
        this.resultParser = resultParser == null ? new ReviewResultParser() : resultParser;
        this.attemptGate = attemptGate == null ? AttemptGate.none() : attemptGate;
        this.verification = verification;
        this.harnessFactory = harnessFactory;
        if (verification == null || harnessFactory == null) {
            throw new IllegalArgumentException("verification and harnessFactory are required");
        }
    }

    public Outcome process(Job job) {
        long startedAt = System.currentTimeMillis();
        if (job == null || job.ticket() == null) {
            return Outcome.failed("review job is required", startedAt);
        }
        Ticket ticket = job.ticket();
        if (!"review".equals(ticket.getStatus())) {
            return Outcome.skipped("ticket status is not review", startedAt);
        }
        if (isBlank(ticket.getPrUrl())) {
            return Outcome.skipped("ticket has no pr_url", startedAt);
        }

        String sha;
        try {
            sha = normalizeSha(job.headSha());
        } catch (IllegalArgumentException error) {
            return Outcome.failed(error.getMessage(), startedAt);
        }
        if (job.workspace() == null || !Files.isDirectory(job.workspace())) {
            return Outcome.failed("review workspace is missing", startedAt);
        }

        String prompt;
        try {
            prompt = promptBuilder.build(job.prompt());
        } catch (RuntimeException error) {
            return Outcome.failed("review prompt is invalid: " + safe(error), startedAt);
        }

        try {
            if (attemptGate.hasCompletedAttempt(ticket.getId(), sha)) {
                return Outcome.skipped("review already completed for this SHA", startedAt);
            }
        } catch (IOException | RuntimeException error) {
            return Outcome.failed("idempotency check failed: " + safe(error), startedAt);
        }

        List<VerificationResult> verificationResults;
        try {
            List<VerificationResult> results = verification.run(job.workspace());
            verificationResults = results == null ? List.of() : List.copyOf(results);
        } catch (IOException | RuntimeException error) {
            return Outcome.failed("verification failed to run: " + safe(error), startedAt);
        }

        String reviewText;
        try (ReviewHarnessClient client = harnessFactory.open()) {
            reviewText = client.review(job.workspace(), sessionTitle(ticket, sha), prompt);
        } catch (IOException | RuntimeException error) {
            return Outcome.failed("review harness failed: " + safe(error), startedAt);
        }

        ReviewResultParser.Result parsed;
        try {
            parsed = resultParser.parse(reviewText, changedFiles(job.prompt()));
        } catch (ReviewResultParser.InvalidReviewException error) {
            return Outcome.failed("invalid review output: " + safe(error), startedAt);
        }

        ReviewResultParser.Result guarded = enforceApprovalGuard(parsed, verificationResults);
        return Outcome.completed(
            sha,
            guarded,
            verificationResults,
            System.currentTimeMillis() - startedAt
        );
    }

    /**
     * Production wiring for a trusted repository. Sandbox-owned verification is
     * wired by fg-31d/fg-34; this path reuses the supervisor's sanitized
     * {@link VerificationRunner} and fails closed when no command is found.
     */
    public static Verification hostVerification(HarnessConfig config, Duration timeout) {
        VerificationRunner runner = new VerificationRunner(config);
        Duration effective = timeout == null ? DEFAULT_VERIFICATION_TIMEOUT : timeout;
        return workspace -> {
            List<VerificationResult> results = new ArrayList<>();
            results.addAll(runner.run(workspace, runner.resolveInstallCommands(workspace), effective));
            results.addAll(runner.run(workspace, runner.resolveCommands(workspace), effective));
            return results;
        };
    }

    private static ReviewResultParser.Result enforceApprovalGuard(
        ReviewResultParser.Result result,
        List<VerificationResult> verification
    ) {
        if (!"approve".equals(result.verdict())) {
            return result;
        }
        if (result.hasCriticalFinding()) {
            return withVerdict(
                result,
                "request_changes",
                "Approval withheld: critical findings.\n\n" + result.summary()
            );
        }
        if (!verificationPassed(verification)) {
            return withVerdict(
                result,
                "comment",
                "Approval withheld: supervisor verification did not pass.\n\n" + result.summary()
            );
        }
        return result;
    }

    private static boolean verificationPassed(List<VerificationResult> verification) {
        if (verification == null || verification.isEmpty()) {
            return false;
        }
        for (VerificationResult result : verification) {
            if (result == null || !result.passed()) {
                return false;
            }
        }
        return true;
    }

    private static ReviewResultParser.Result withVerdict(
        ReviewResultParser.Result result,
        String verdict,
        String summary
    ) {
        return new ReviewResultParser.Result(
            verdict,
            summary,
            result.findings(),
            result.residualRisks(),
            result.humanQuestions()
        );
    }

    private static List<String> changedFiles(ReviewPromptBuilder.Request request) {
        if (request == null || request.pullRequest() == null) {
            return List.of();
        }
        return request.pullRequest().files().stream()
            .map(ReviewPromptBuilder.ChangedFile::path)
            .toList();
    }

    private static String sessionTitle(Ticket ticket, String sha) {
        return "review-" + ticket.getId() + "-" + sha.substring(0, 7);
    }

    static String normalizeSha(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("review SHA is required");
        }
        String sha = value.trim().toLowerCase(Locale.ROOT);
        if (!sha.matches("^[0-9a-f]{40}([0-9a-f]{24})?$")) {
            throw new IllegalArgumentException(
                "review SHA must be 40 or 64 hexadecimal characters"
            );
        }
        return sha;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String safe(Throwable error) {
        if (error == null) {
            return "unknown error";
        }
        String message = error.getMessage();
        if (message == null || message.isBlank()) {
            message = error.getClass().getSimpleName();
        }
        return REDACTOR.redact(message);
    }

    public enum Status {
        SKIPPED,
        FAILED,
        COMPLETED
    }

    public record Job(
        Ticket ticket,
        ReviewPromptBuilder.Request prompt,
        Path workspace,
        String headSha
    ) {
    }

    public record Outcome(
        Status status,
        String reason,
        String reviewedSha,
        ReviewResultParser.Result result,
        List<VerificationResult> verification,
        long durationMs
    ) {
        public Outcome {
            verification = verification == null ? List.of() : List.copyOf(verification);
        }

        public boolean approved() {
            return status == Status.COMPLETED
                && result != null
                && "approve".equals(result.verdict());
        }

        static Outcome skipped(String reason, long startedAt) {
            return new Outcome(
                Status.SKIPPED, reason, null, null, List.of(), elapsed(startedAt));
        }

        static Outcome failed(String reason, long startedAt) {
            return new Outcome(
                Status.FAILED, reason, null, null, List.of(), elapsed(startedAt));
        }

        static Outcome completed(
            String reviewedSha,
            ReviewResultParser.Result result,
            List<VerificationResult> verification,
            long durationMs
        ) {
            return new Outcome(
                Status.COMPLETED, null, reviewedSha, result, verification, durationMs);
        }

        private static long elapsed(long startedAt) {
            return Math.max(0, System.currentTimeMillis() - startedAt);
        }
    }

    @FunctionalInterface
    public interface AttemptGate {
        boolean hasCompletedAttempt(Long ticketId, String reviewedSha) throws IOException;

        static AttemptGate none() {
            return (ticketId, reviewedSha) -> false;
        }
    }

    @FunctionalInterface
    public interface Verification {
        List<VerificationResult> run(Path workspace) throws IOException;
    }

    @FunctionalInterface
    public interface HarnessFactory {
        ReviewHarnessClient open() throws IOException;
    }
}
