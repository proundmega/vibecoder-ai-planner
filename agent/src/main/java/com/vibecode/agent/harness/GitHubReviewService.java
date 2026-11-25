package com.vibecode.agent.harness;

import com.vibecode.agent.service.GitHubService;

import java.io.IOException;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Publishes a Phase 1 review to GitHub (fg-31d, FR5/FR7).
 *
 * <p>Reviews are always {@code event=COMMENT} against the exact reviewed
 * commit. Before posting, the PR head is re-fetched and an existing review with
 * the deterministic attempt marker is adopted, so a post-success/DB-failure
 * retry never posts twice. Findings are rendered into the summary body; inline
 * comments are intentionally deferred until the line is known to be
 * commentable.</p>
 */
public final class GitHubReviewService {

    static final int MAX_BODY_CHARS = 60_000;
    private static final Pattern SHA = Pattern.compile("^[0-9a-f]{40}([0-9a-f]{24})?$");

    private final GitHubService gitHub;

    public GitHubReviewService(GitHubService gitHub) {
        if (gitHub == null) {
            throw new IllegalArgumentException("GitHubService is required");
        }
        this.gitHub = gitHub;
    }

    public PublishResult publish(
        int pullNumber,
        String reviewedSha,
        String attemptId,
        ReviewResultParser.Result result
    ) throws IOException {
        if (pullNumber <= 0) {
            throw new IOException("A pull request number is required");
        }
        String sha = normalizeSha(reviewedSha);
        if (attemptId == null || attemptId.isBlank()) {
            throw new IOException("A review attempt id is required");
        }
        if (result == null) {
            throw new IOException("A review result is required");
        }

        String head = gitHub.getPullRequestHeadSha(pullNumber);
        if (head == null || !sha.equalsIgnoreCase(head.trim())) {
            throw new HeadMovedException(
                "PR head moved from " + sha + " to " + (head == null ? "unknown" : head.trim()));
        }

        String marker = marker(attemptId);
        List<GitHubService.PullRequestReview> reviews =
            gitHub.listPullRequestReviews(pullNumber);
        for (GitHubService.PullRequestReview review : reviews) {
            if (sha.equalsIgnoreCase(review.commitId())
                && review.body() != null
                && review.body().contains(marker)) {
                return new PublishResult(review.id(), true);
            }
        }

        long reviewId = gitHub.createPullRequestReview(
            pullNumber, sha, body(marker, result));
        return new PublishResult(reviewId, false);
    }

    public static String marker(String attemptId) {
        return "<!-- fg-31-review:" + (attemptId == null ? "" : attemptId.trim()) + " -->";
    }

    static String body(String marker, ReviewResultParser.Result result) {
        StringBuilder body = new StringBuilder();
        body.append(marker).append("\n\n");
        body.append("## Automated review\n\n");
        body.append("**Verdict:** ").append(result.verdict()).append("\n\n");
        body.append(result.summary()).append("\n\n");

        if (!result.findings().isEmpty()) {
            body.append("### Findings\n\n");
            for (ReviewResultParser.Finding finding : result.findings()) {
                body.append("- **[").append(finding.severity()).append("]** ");
                if (finding.file() != null) {
                    body.append('`').append(finding.file()).append('`');
                    if (finding.line() != null) {
                        body.append(':').append(finding.line());
                    }
                    body.append(" — ");
                }
                body.append(finding.message()).append('\n');
                if (finding.suggestion() != null && !finding.suggestion().isBlank()) {
                    body.append("  - Suggestion: ").append(finding.suggestion()).append('\n');
                }
            }
            body.append('\n');
        }
        appendList(body, "Residual risks", result.residualRisks());
        appendList(body, "Human questions", result.humanQuestions());

        if (body.length() > MAX_BODY_CHARS) {
            return body.substring(0, MAX_BODY_CHARS) + "\n\n[review truncated]";
        }
        return body.toString();
    }

    private static void appendList(StringBuilder body, String title, List<String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        body.append("### ").append(title).append("\n\n");
        for (String value : values) {
            body.append("- ").append(value).append('\n');
        }
        body.append('\n');
    }

    private static String normalizeSha(String value) throws IOException {
        if (value == null || value.isBlank()) {
            throw new IOException("A reviewed SHA is required");
        }
        String sha = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!SHA.matcher(sha).matches()) {
            throw new IOException("The reviewed SHA must be 40 or 64 hexadecimal characters");
        }
        return sha;
    }

    public record PublishResult(long reviewId, boolean adopted) {
    }

    public static final class HeadMovedException extends IOException {
        public HeadMovedException(String message) {
            super(message);
        }
    }
}
