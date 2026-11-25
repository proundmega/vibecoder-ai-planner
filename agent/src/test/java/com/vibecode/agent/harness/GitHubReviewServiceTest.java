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

    @Test
    void publishesACommentReviewWithTheAttemptMarker() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        GitHubReviewService service = new GitHubReviewService(gitHub);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertEquals(99L, result.reviewId());
        assertFalse(result.adopted());
        assertEquals(1, gitHub.createCalls);
        assertEquals(SHA, gitHub.createdCommit);
        assertTrue(gitHub.createdBody.contains(GitHubReviewService.marker("attempt-1")));
        assertTrue(gitHub.createdBody.contains("Automated review"));
        assertTrue(gitHub.createdBody.contains("request_changes"));
        assertTrue(gitHub.createdBody.contains("critical"));
        assertTrue(gitHub.createdBody.contains("backend/src/App.js"));
        assertTrue(gitHub.createdBody.contains(":4"));
        assertTrue(gitHub.createdBody.contains("Add the guard"));
        assertTrue(gitHub.createdBody.contains("Human questions"));
    }

    @Test
    void adoptsAnExistingReviewForTheSameCommitAndMarker() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.reviews = List.of(new GitHubService.PullRequestReview(
            7L,
            SHA,
            "previous\n" + GitHubReviewService.marker("attempt-1"),
            "reviewer"
        ));
        GitHubReviewService service = new GitHubReviewService(gitHub);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertTrue(result.adopted());
        assertEquals(7L, result.reviewId());
        assertEquals(0, gitHub.createCalls);
    }

    @Test
    void ignoresReviewsForAnotherCommitOrMarker() throws Exception {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.reviews = new ArrayList<>(List.of(
            new GitHubService.PullRequestReview(
                8L, OTHER_SHA, GitHubReviewService.marker("attempt-1"), "reviewer"),
            new GitHubService.PullRequestReview(
                9L, SHA, GitHubReviewService.marker("other-attempt"), "reviewer")
        ));
        GitHubReviewService service = new GitHubReviewService(gitHub);

        GitHubReviewService.PublishResult result = service.publish(
            7, SHA, "attempt-1", reviewResult());

        assertFalse(result.adopted());
        assertEquals(1, gitHub.createCalls);
    }

    @Test
    void refusesWhenThePullRequestHeadMoved() {
        FakeGitHub gitHub = new FakeGitHub();
        gitHub.head = OTHER_SHA;
        GitHubReviewService service = new GitHubReviewService(gitHub);

        assertThrows(GitHubReviewService.HeadMovedException.class,
            () -> service.publish(7, SHA, "attempt-1", reviewResult()));
        assertEquals(0, gitHub.createCalls);
    }

    @Test
    void rejectsAnInvalidReviewedSha() {
        GitHubReviewService service = new GitHubReviewService(new FakeGitHub());

        assertThrows(IOException.class,
            () -> service.publish(7, "abc1234", "attempt-1", reviewResult()));
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
        private List<PullRequestReview> reviews = List.of();
        private int createCalls;
        private String createdCommit;
        private String createdBody;

        private FakeGitHub() {
            super("token", "owner", "repo");
        }

        @Override
        public String getPullRequestHeadSha(int pullNumber) {
            return head;
        }

        @Override
        public List<PullRequestReview> listPullRequestReviews(int pullNumber) {
            return reviews;
        }

        @Override
        public long createPullRequestReview(int pullNumber, String commitId, String body) {
            createCalls++;
            createdCommit = commitId;
            createdBody = body;
            return 99L;
        }
    }
}
