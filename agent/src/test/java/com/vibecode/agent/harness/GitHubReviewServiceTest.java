package com.vibecode.agent.harness;

import com.vibecode.agent.service.GitHubService;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GitHubReviewServiceTest {

    private static final String SHA = "a".repeat(40);
    private static final String OTHER_SHA = "b".repeat(40);
    private static final String REVIEWER = "reviewer";

    @Test
    void publishesACommentReviewWithTheAttemptMarker() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertEquals(99L, result.reviewId());
        assertFalse(result.adopted());
        assertEquals(1, gitHub.createCalls);
        assertEquals(SHA, gitHub.createdCommit);
        assertTrue(gitHub.createdBody.startsWith(
            GitHubReviewService.marker("attempt-1")));
        assertTrue(gitHub.createdBody.contains("Automated review"));
        assertTrue(gitHub.createdBody.contains("request_changes"));
        assertTrue(gitHub.createdBody.contains("critical"));
        assertTrue(gitHub.createdBody.contains("backend/src/App.js"));
        assertTrue(gitHub.createdBody.contains(":4"));
        assertTrue(gitHub.createdBody.contains("Add the guard"));
        assertTrue(gitHub.createdBody.contains("Human questions"));
    }

    @Test
    void adoptsAnExistingCommentReviewByTheExpectedAuthor() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.reviews = List.of(review(
            7L, SHA, "COMMENTED", REVIEWER,
            GitHubReviewService.marker("attempt-1") + "\n\nprevious"));
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertTrue(result.adopted());
        assertEquals(7L, result.reviewId());
        assertEquals(0, gitHub.createCalls);
    }

    @Test
    void doesNotAdoptAnotherAuthorsReview() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.reviews = List.of(review(
            7L, SHA, "COMMENTED", "mallory",
            GitHubReviewService.marker("attempt-1")));
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertFalse(result.adopted());
        assertEquals(1, gitHub.createCalls);
    }

    @Test
    void doesNotAdoptDismissedOrPendingReviews() throws Exception {
        for (String state : List.of("DISMISSED", "PENDING", "APPROVED")) {
            FakeGitHub gitHub = new FakeGitHub();
            gitHub.reviews = List.of(review(
                7L, SHA, state, REVIEWER,
                GitHubReviewService.marker("attempt-1")));
            GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

            GitHubReviewService.PublishResult result = service.publish(
                7, SHA, "attempt-1", reviewResult());

            assertFalse(result.adopted(), "state " + state);
            assertEquals(1, gitHub.createCalls, "state " + state);
        }
    }

    @Test
    void doesNotAdoptWhenTheMarkerIsNotAtTheStart() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.reviews = List.of(review(
            7L, SHA, "COMMENTED", REVIEWER,
            "prefix " + GitHubReviewService.marker("attempt-1")));
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertFalse(result.adopted());
        assertEquals(1, gitHub.createCalls);
    }

    @Test
    void adoptsBeforeTheHeadCheckForPartialPublishRecovery() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.head = OTHER_SHA;
        gitHub.reviews = List.of(review(
            7L, SHA, "COMMENTED", REVIEWER,
            GitHubReviewService.marker("attempt-1")));
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertTrue(result.adopted());
        assertEquals(0, gitHub.headCalls);
    }

    @Test
    void refusesWhenTheHeadMovesDuringTheReviewList() {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.listHook = () -> gitHub.head = OTHER_SHA;
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        assertThrows(GitHubReviewService.HeadMovedException.class,
            () -> service.publish(7, SHA, "attempt-1", reviewResult()));
        assertEquals(0, gitHub.createCalls);
        assertTrue(gitHub.headCalls >= 1);
    }

    @Test
    void refusesWhenTheHeadAlreadyMovedAndNoReviewExists() {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.head = OTHER_SHA;
        GitHubReviewService service = new GitHubReviewService(gitHub, REVIEWER);

        assertThrows(GitHubReviewService.HeadMovedException.class,
            () -> service.publish(7, SHA, "attempt-1", reviewResult()));
        assertEquals(0, gitHub.createCalls);
    }

    @Test
    void rejectsAnInvalidReviewedSha() {
        GitHubReviewService service = new GitHubReviewService(new FakeGitHub(), REVIEWER);

        assertThrows(IOException.class,
            () -> service.publish(7, "abc1234", "attempt-1", reviewResult()));
    }

    @Test
    void truncatesAnOversizedReviewBody() {
        ReviewResultParser.Result huge = new ReviewResultParser.Result(
            "comment",
            "x".repeat(70_000),
            List.of(),
            List.of(),
            List.of());

        String body = GitHubReviewService.body(
            GitHubReviewService.marker("attempt-1"), huge);

        assertTrue(body.length() <= GitHubReviewService.MAX_BODY_CHARS + 30);
        assertTrue(body.endsWith("[review truncated]"));
    }

    @Test
    void propagatesListAndCreateErrors() {
        FakeGitHub listFailure = new FakeGitHub();
        listFailure.failList = true;
        assertThrows(IOException.class,
            () -> new GitHubReviewService(listFailure, REVIEWER)
                .publish(7, SHA, "attempt-1", reviewResult()));

        FakeGitHub createFailure = new FakeGitHub();
        createFailure.failCreate = true;
        assertThrows(IOException.class,
            () -> new GitHubReviewService(createFailure, REVIEWER)
                .publish(7, SHA, "attempt-1", reviewResult()));
    }

    private static GitHubService.PullRequestReview review(
        long id,
        String commit,
        String state,
        String author,
        String body
    ) {
        return new GitHubService.PullRequestReview(id, commit, body, author, state);
    }

    private static ReviewResultParser.Result reviewResult() {
        return new ReviewResultParser.Result(
            "request_changes",
            "One blocking issue.",
            List.of(new ReviewResultParser.Finding(
                "critical",
                "backend/src/App.js",
                4,
                "The owner scope is dropped.",
                "Add the guard")),
            List.of("Pagination is untested"),
            List.of("Should admins see every project?")
        );
    }

    private static final class FakeGitHub extends GitHubService {

        private String head = SHA;
        private List<PullRequestReview> reviews = new ArrayList<>();
        private Runnable listHook = () -> { };
        private boolean failList;
        private boolean failCreate;
        private int headCalls;
        private int createCalls;
        private String createdCommit;
        private String createdBody;

        private FakeGitHub() {
            super("token", "owner", "repo");
        }

        @Override
        public String getPullRequestHeadSha(int pullNumber) {
            headCalls++;
            return head;
        }

        @Override
        public List<PullRequestReview> listPullRequestReviews(int pullNumber)
            throws IOException {
            listHook.run();
            if (failList) {
                throw new IOException("list failed");
            }
            return reviews;
        }

        @Override
        public long createPullRequestReview(int pullNumber, String commitId, String body)
            throws IOException {
            if (failCreate) {
                throw new IOException("create failed");
            }
            createCalls++;
            createdCommit = commitId;
            createdBody = body;
            return 99L;
        }
    }
}
