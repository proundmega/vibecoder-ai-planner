package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubService;
import com.vibecode.agent.service.WorkspaceManager;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HarnessTicketProcessorTest {

    @TempDir
    Path tempDir;

    private AgentConfig config;
    private ApiService apiService;
    private GitHubService gitHubService;
    private WorkspaceManager workspace;
    private HarnessClient harness;
    private PlanningDocFetcher planningDocFetcher;
    private VerificationRunner verificationRunner;
    private HarnessTicketProcessor processor;

    private final ProviderSettings provider = new ProviderSettings(
        "opencode-go", "secret-key", null, "beam-free", 4096);

    private final HarnessConfig harnessConfig = new HarnessConfig(
        "opencode", "opencode", Duration.ofSeconds(30),
        Duration.ofMinutes(45), List.of("npm test"),
        List.of(".env*", ".github/workflows/**", "**/secrets/**"), null, "restart");

    @BeforeEach
    void setUp() throws Exception {
        config = mock(AgentConfig.class);
        when(config.getRepoName()).thenReturn("repo");
        when(config.getRepoOwner()).thenReturn("owner");
        when(config.getRepoCloneDir()).thenReturn(tempDir.toString());
        when(config.isDryRun()).thenReturn(false);
        when(config.getGitHubBranchName(1L, "Add filtering"))
            .thenReturn("vibecode/ticket-1-add-filtering");

        Ticket ticket = new Ticket();
        ticket.setId(1L);
        ticket.setTitle("Add filtering");
        ticket.setDescription("Filter tickets by status.");
        ticket.setStatus("in_progress");

        apiService = mock(ApiService.class);
        when(apiService.pickUpTicket(1L)).thenReturn(ticket);
        when(apiService.postMessage(any(), anyString(), anyString()))
            .thenReturn(new TicketMessage());
        when(apiService.releaseTicket(1L)).thenReturn(ticket);
        when(apiService.updateTicketStatus(1L, "review")).thenReturn(ticket);

        gitHubService = mock(GitHubService.class);
        when(gitHubService.createPullRequest(anyString(), anyString(), anyString(), anyString()))
            .thenReturn("https://github.com/owner/repo/pull/7");

        workspace = mock(WorkspaceManager.class);
        when(workspace.getRepoDir()).thenReturn(tempDir);
        when(workspace.stageFreshDiff()).thenReturn(new DiffSummary(
            List.of(new DiffSummary.ChangedFile("src/App.java", "modified")), 12, 3));
        when(workspace.guardedChangedBlobs()).thenReturn(List.of());
        when(workspace.commitAndPushStaged(anyString(), anyString())).thenReturn("abc1234");

        harness = mock(HarnessClient.class);
        when(harness.createSession(anyString())).thenReturn("ses_test");

        planningDocFetcher = mock(PlanningDocFetcher.class);
        when(planningDocFetcher.fetch(1L)).thenReturn(List.of("=== 01 ===\nRequirement"));

        verificationRunner = mock(VerificationRunner.class);
        when(verificationRunner.resolveCommands(any())).thenReturn(List.of("npm test"));
        when(verificationRunner.resolveInstallCommands(any())).thenReturn(List.of());
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));

        processor = new HarnessTicketProcessor(
            config, apiService, provider, gitHubService, "ghp_token",
            harnessConfig,
            repoName -> workspace,
            (ignored, bridge) -> harness,
            planningDocFetcher,
            verificationRunner,
            new PublishingGuard(harnessConfig.protectedPaths())
        );
    }

    private HarnessTicketProcessor processorWithResumeMode() {
        HarnessConfig resumeConfig = new HarnessConfig(
            "opencode", "opencode", Duration.ofSeconds(30),
            Duration.ofMinutes(45), List.of("npm test"),
            List.of(".env*", ".github/workflows/**", "**/secrets/**"), null, "resume");
        return new HarnessTicketProcessor(
            config, apiService, provider, gitHubService, "ghp_token",
            resumeConfig,
            repoName -> workspace,
            (ignored, bridge) -> harness,
            planningDocFetcher,
            verificationRunner,
            new PublishingGuard(resumeConfig.protectedPaths())
        );
    }

    @Test
    void startupRecoverySkipsARunWithAFreshHeartbeatOrLease() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-live",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "prompting",
            "heartbeat_at", Instant.now().toString(),
            "lease_expires_at", Instant.now().plusSeconds(600).toString()
        )));

        assertEquals(0, processor.recoverActiveRuns());
        assertTrue(processor.isRecoveryDeferred());

        verify(apiService, never()).finishHarnessRun(
            anyString(), anyString(), any(), any(), any());
        verify(apiService, never()).releaseHarnessTicket(anyString());
        verify(apiService, never()).reconcileHarnessRun(anyString());
    }

    @Test
    void startupRecoverySkipsFreshHeartbeatWithAnExpiredLease() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-fresh-heartbeat",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "heartbeat_at", Instant.now().toString(),
            "lease_expires_at", Instant.now().minusSeconds(60).toString()
        )));

        assertEquals(0, processor.recoverActiveRuns());
        assertTrue(processor.isRecoveryDeferred());
        verify(apiService, never()).releaseHarnessTicket(anyString());
    }

    @Test
    void startupRecoverySkipsAnUnexpiredLeaseWithAStaleHeartbeat() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-fresh-lease",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "heartbeat_at", Instant.now().minusSeconds(3600).toString(),
            "lease_expires_at", Instant.now().plusSeconds(60).toString()
        )));

        assertEquals(0, processor.recoverActiveRuns());
        assertTrue(processor.isRecoveryDeferred());
        verify(apiService, never()).releaseHarnessTicket(anyString());
    }

    @Test
    void startupRecoveryProceedsAfterTheHeartbeatAndLeaseAreStale() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-stale",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "prompting",
            "heartbeat_at", Instant.now().minusSeconds(3600).toString(),
            "lease_expires_at", Instant.now().minusSeconds(3600).toString()
        )));
        when(apiService.finishHarnessRun(
            eq("run-stale"), eq("failed"), anyString(), isNull(), isNull()))
            .thenReturn("failed");
        when(apiService.releaseHarnessTicket("run-stale")).thenReturn(true);

        assertEquals(1, processor.recoverActiveRuns());
        assertFalse(processor.isRecoveryDeferred());

        verify(apiService).finishHarnessRun(
            eq("run-stale"), eq("failed"), anyString(), isNull(), isNull());
        verify(apiService).releaseHarnessTicket("run-stale");
    }

    @Test
    void startupRecoveryFailsInterruptedRunsAndReleasesThroughTheGuard() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "prompting",
            "last_checkpoint_payload", Map.of()
        )));
        when(apiService.finishHarnessRun(
            eq("run-old"), eq("failed"), anyString(), isNull(), isNull()))
            .thenReturn("failed");
        when(apiService.releaseHarnessTicket("run-old")).thenReturn(true);

        assertEquals(1, processor.recoverActiveRuns());

        verify(apiService).finishHarnessRun(
            eq("run-old"), eq("failed"), anyString(), isNull(), isNull());
        verify(apiService).releaseHarnessTicket("run-old");
        verify(apiService).reconcileHarnessRun("run-old");
        verify(apiService, never()).finishHarnessRun(
            eq("run-old"), eq("succeeded"), any(), any(), any());
    }

    @Test
    void startupRecoveryAdoptsAPublishedRunAndKeepsTheTicketInReview() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "done",
            "ticket_status", "in_progress",
            "head_sha", "abc1234",
            "pr_url", "https://github.com/owner/repo/pull/7"
        )));
        when(apiService.finishHarnessRun(
            "run-old", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7"))
            .thenReturn("succeeded");

        assertEquals(1, processor.recoverActiveRuns());

        verify(apiService).updateTicketPrUrl(
            1L, "https://github.com/owner/repo/pull/7");
        verify(apiService).updateTicketStatus(1L, "review");
        verify(apiService).reconcileHarnessRun("run-old");
        verify(apiService, never()).releaseHarnessTicket("run-old");
        verify(apiService, never()).releaseTicket(1L);
        verify(apiService, never()).finishHarnessRun(
            eq("run-old"), eq("failed"), any(), any(), any());
    }

    @Test
    void startupRecoveryKeepsANewerTicketPrInsteadOfOverwritingIt() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "done",
            "ticket_status", "review",
            "ticket_pr_url", "https://github.com/owner/repo/pull/new",
            "pr_url", "https://github.com/owner/repo/pull/old"
        )));
        when(apiService.finishHarnessRun(
            "run-old", "succeeded", null, null,
            "https://github.com/owner/repo/pull/old"))
            .thenReturn("succeeded");

        assertEquals(1, processor.recoverActiveRuns());

        verify(apiService, never()).updateTicketPrUrl(any(), anyString());
        verify(apiService, never()).updateTicketStatus(any(), anyString());
        verify(apiService, never()).releaseHarnessTicket("run-old");
    }

    @Test
    void startupRecoveryLeavesABacklogStatusForBackendReconciliation() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "done",
            "ticket_status", "backlog",
            "pr_url", "https://github.com/owner/repo/pull/9"
        )));
        when(apiService.finishHarnessRun(
            "run-old", "succeeded", null, null,
            "https://github.com/owner/repo/pull/9"))
            .thenReturn("succeeded");

        assertEquals(1, processor.recoverActiveRuns());

        verify(apiService).updateTicketPrUrl(
            1L, "https://github.com/owner/repo/pull/9");
        // backlog -> review is not a valid API transition; the synchronous
        // reconcile call lets the backend own it.
        verify(apiService, never()).updateTicketStatus(any(), anyString());
        verify(apiService).reconcileHarnessRun("run-old");
        verify(apiService, never()).releaseHarnessTicket("run-old");
    }

    @Test
    void resumeModeFindsTheExistingPrForAPublishingRun() throws Exception {
        HarnessTicketProcessor resumeProcessor = processorWithResumeMode();
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "publishing",
            "ticket_status", "in_progress",
            "head_sha", "abc1234",
            "last_checkpoint_payload", Map.of()
        )));
        when(gitHubService.findPullRequestUrl("vibecode/ticket-1-add-filtering"))
            .thenReturn("https://github.com/owner/repo/pull/7");
        when(apiService.finishHarnessRun(
            "run-old", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7"))
            .thenReturn("succeeded");

        assertEquals(1, resumeProcessor.recoverActiveRuns());

        verify(gitHubService).findPullRequestUrl("vibecode/ticket-1-add-filtering");
        verify(apiService).finishHarnessRun(
            "run-old", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7");
        verify(apiService, never()).releaseHarnessTicket("run-old");
    }

    @Test
    void startupRecoveryNeverRegressesADoneTicket() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "done",
            "ticket_status", "done",
            "pr_url", "https://github.com/owner/repo/pull/7"
        )));
        when(apiService.finishHarnessRun(
            "run-old", "succeeded", null, null,
            "https://github.com/owner/repo/pull/7"))
            .thenReturn("succeeded");

        assertEquals(1, processor.recoverActiveRuns());

        verify(apiService, never()).updateTicketStatus(any(), anyString());
        verify(apiService, never()).updateTicketPrUrl(any(), anyString());
        verify(apiService, never()).releaseHarnessTicket("run-old");
    }

    @Test
    void startupRecoveryDoesNotAdoptAStaleTicketPrWithoutRunEvidence() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "prompting",
            "ticket_status", "review",
            "ticket_pr_url", "https://github.com/owner/repo/pull/4"
        )));
        when(apiService.finishHarnessRun(
            eq("run-old"), eq("failed"), anyString(), isNull(), isNull()))
            .thenReturn("failed");
        when(apiService.releaseHarnessTicket("run-old")).thenReturn(false);

        assertEquals(1, processor.recoverActiveRuns());

        verify(apiService, never()).updateTicketPrUrl(any(), anyString());
        verify(apiService, never()).updateTicketStatus(any(), anyString());
        verify(apiService, never()).finishHarnessRun(
            eq("run-old"), eq("succeeded"), any(), any(), any());
    }

    @Test
    void startupRecoveryDoesNotReleaseWhenAFinishReturnsTheWrongTerminalStatus() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "prompting",
            "ticket_status", "in_progress"
        )));
        when(apiService.finishHarnessRun(
            eq("run-old"), eq("failed"), anyString(), isNull(), isNull()))
            .thenReturn("succeeded");

        assertEquals(0, processor.recoverActiveRuns());

        verify(apiService, never()).releaseHarnessTicket("run-old");
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void startupRecoveryReportsListFailureSoTheAppCanRetry() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L))
            .thenThrow(new IOException("backend down"));

        assertEquals(-1, processor.recoverActiveRuns());
    }

    @Test
    void startupRecoveryLeavesTheRunWhenFinishCannotBeConfirmed() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveHarnessRuns(7L)).thenReturn(List.of(Map.of(
            "id", "run-old",
            "ticket_id", "1",
            "branch", "vibecode/ticket-1-add-filtering",
            "step", "prompting"
        )));
        when(apiService.finishHarnessRun(
            eq("run-old"), eq("failed"), anyString(), isNull(), isNull()))
            .thenThrow(new IOException("backend down"))
            .thenThrow(new IOException("backend down"))
            .thenThrow(new IOException("backend down"));

        assertEquals(0, processor.recoverActiveRuns());

        verify(apiService, never()).releaseHarnessTicket("run-old");
        verify(apiService, never()).releaseTicket(1L);
    }

    private Ticket ticket() {
        Ticket ticket = new Ticket();
        ticket.setId(1L);
        ticket.setTitle("Add filtering");
        ticket.setDescription("Filter tickets by status.");
        return ticket;
    }

    @Test
    void pullRequestBodyIsRedactedBeforePublishing() throws Exception {
        Ticket ticket = ticket();
        ticket.setDescription("Do not leak ghp_abcdefghijklmnopqrstuvwxyz012345 "
            + "or password=super-secret");
        when(apiService.pickUpTicket(1L)).thenReturn(ticket);

        processor.processTicket(ticket);

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(gitHubService).createPullRequest(
            anyString(), body.capture(), anyString(), anyString());
        assertFalse(body.getValue().contains("ghp_abcdefghijklmnopqrstuvwxyz012345"),
            "Leaked GitHub-shaped token into the PR body");
        assertFalse(body.getValue().contains("super-secret"),
            "Leaked password into the PR body");
        assertTrue(body.getValue().contains("Add filtering"), body.getValue());
    }

    @Test
    void pullRequestTitleAndCommitMessageAreRedactedBeforePublishing() throws Exception {
        String token = "ghp_abcdefghijklmnopqrstuvwxyz012345";
        Ticket ticket = ticket();
        ticket.setTitle("Add filtering " + token);
        when(apiService.pickUpTicket(1L)).thenReturn(ticket);
        when(config.getGitHubBranchName(1L, "Add filtering [REDACTED]"))
            .thenReturn("vibecode/ticket-1-redacted");

        processor.processTicket(ticket);

        ArgumentCaptor<String> title = ArgumentCaptor.forClass(String.class);
        verify(gitHubService).createPullRequest(
            title.capture(), anyString(), anyString(), anyString());
        assertFalse(title.getValue().contains(token), "Leaked token into the PR title");
        assertTrue(title.getValue().contains("Add filtering"), title.getValue());

        ArgumentCaptor<String> commitMessage = ArgumentCaptor.forClass(String.class);
        verify(workspace).commitAndPushStaged(commitMessage.capture(), anyString());
        assertFalse(commitMessage.getValue().contains(token),
            "Leaked token into the commit message");
    }

    @Test
    void branchNameIsDerivedFromTheRedactedTitle() throws Exception {
        String token = "ghp_abcdefghijklmnopqrstuvwxyz012345";
        Ticket ticket = ticket();
        ticket.setTitle("Add filtering " + token);
        when(apiService.pickUpTicket(1L)).thenReturn(ticket);
        when(config.getGitHubBranchName(1L, "Add filtering [REDACTED]"))
            .thenReturn("vibecode/ticket-1-add-filtering-redacted");

        processor.processTicket(ticket);

        verify(config).getGitHubBranchName(1L, "Add filtering [REDACTED]");
        verify(apiService).startHarnessRun(
            1L, "vibecode/ticket-1-add-filtering-redacted",
            null, "opencode-go", "beam-free", 1);

        ArgumentCaptor<String> pushedBranch = ArgumentCaptor.forClass(String.class);
        verify(workspace).commitAndPushStaged(anyString(), pushedBranch.capture());
        assertFalse(pushedBranch.getValue().contains(token), pushedBranch.getValue());

        ArgumentCaptor<String> prBranch = ArgumentCaptor.forClass(String.class);
        verify(gitHubService).createPullRequest(
            anyString(), anyString(), prBranch.capture(), anyString());
        assertFalse(prBranch.getValue().contains(token), prBranch.getValue());
    }

    @Test
    void happyPathPromptsVerifiesPublishesAndSetsReview() throws Exception {
        processor.processTicket(ticket());

        verify(harness).start(tempDir);
        verify(harness).sendPrompt(eq("ses_test"), contains("Add filtering"));
        verify(verificationRunner).run(eq(tempDir), eq(List.of("npm test")), any());
        verify(workspace).stageFreshDiff();
        verify(workspace).commitAndPushStaged("feat: Add filtering", "vibecode/ticket-1-add-filtering");
        verify(workspace).discardStaged();
        verify(gitHubService).createPullRequest(
            eq("feat: Add filtering"), anyString(),
            eq("vibecode/ticket-1-add-filtering"), eq("main"));
        verify(apiService).updateTicketPrUrl(1L, "https://github.com/owner/repo/pull/7");
        verify(apiService).updateTicketStatus(1L, "review");
        verify(harness).close();
        verify(workspace).cleanup();
    }

    @Test
    void closesHarnessAndStagesBeforePublishing() throws Exception {
        processor.processTicket(ticket());

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(harness, workspace);
        order.verify(harness).sendPrompt(eq("ses_test"), anyString());
        order.verify(harness).close();
        order.verify(workspace).stageFreshDiff();
        order.verify(workspace).commitAndPushStaged(
            "feat: Add filtering", "vibecode/ticket-1-add-filtering");
    }

    @Test
    void refusesToPublishWhenNoVerificationCommandsExist() throws Exception {
        when(verificationRunner.resolveCommands(any())).thenReturn(List.of());

        processor.processTicket(ticket());

        verify(harness, never()).start(any());
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("No verification commands")));
    }

    @Test
    void dependencyInstallFailureStopsBeforeVerification() throws Exception {
        when(verificationRunner.resolveInstallCommands(any())).thenReturn(List.of("npm ci"));
        when(verificationRunner.run(any(), eq(List.of("npm ci")), any()))
            .thenReturn(List.of(new VerificationResult("npm ci", 1, "install exploded", false)));

        processor.processTicket(ticket());

        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Dependency installation failed")
                && message.contains("install exploded")));
    }

    @Test
    void postPublishBookkeepingFailureDoesNotDiscardThePush() throws Exception {
        doThrow(new IOException("ticket API down"))
            .when(apiService).updateTicketPrUrl(1L, "https://github.com/owner/repo/pull/7");
        doThrow(new IOException("ticket API down"))
            .when(apiService).updateTicketStatus(1L, "review");

        processor.processTicket(ticket());

        verify(workspace).commitAndPushStaged(
            "feat: Add filtering", "vibecode/ticket-1-add-filtering");
        verify(apiService, never()).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Harness completed")));
    }

    @Test
    void postPublishFailureWithoutADurableRunNeverReleasesTheTicket() throws Exception {
        doThrow(new IOException("github down"))
            .when(gitHubService).createPullRequest(
                anyString(), anyString(), anyString(), anyString());

        processor.processTicket(ticket());

        verify(workspace).commitAndPushStaged(
            "feat: Add filtering", "vibecode/ticket-1-add-filtering");
        verify(apiService, never()).releaseTicket(1L);
        verify(apiService, never()).releaseHarnessTicket(anyString());
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("already published")
                && message.contains("operator review")));
    }

    @Test
    void postPublishFailureWithADurableRunPersistsHeadShaAndNeverReleases() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new IOException("github down"))
            .when(gitHubService).createPullRequest(
                anyString(), anyString(), anyString(), anyString());

        processor.processTicket(ticket());

        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), eq("abc1234"), isNull());
        verify(apiService, never()).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void durableRunErrorIsRedactedBeforeFinishing() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        String token = "ghp_abcdefghijklmnopqrstuvwxyz012345";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new IOException("github failed with " + token))
            .when(gitHubService).createPullRequest(
                anyString(), anyString(), anyString(), anyString());

        processor.processTicket(ticket());

        ArgumentCaptor<String> error = ArgumentCaptor.forClass(String.class);
        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), error.capture(), eq("abc1234"), isNull());
        assertFalse(error.getValue().contains(token), error.getValue());
        assertTrue(error.getValue().contains("[REDACTED]"), error.getValue());
    }

    @Test
    void processingLogDoesNotContainTheRawTicketTitle() throws Exception {
        String token = "ghp_abcdefghijklmnopqrstuvwxyz012345";
        Ticket ticket = ticket();
        ticket.setTitle("Add filtering " + token);
        when(apiService.pickUpTicket(1L)).thenReturn(ticket);
        when(config.getGitHubBranchName(1L, "Add filtering [REDACTED]"))
            .thenReturn("vibecode/ticket-1-redacted");

        Logger logger = (Logger) LoggerFactory.getLogger(HarnessTicketProcessor.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            processor.processTicket(ticket);
        } finally {
            logger.detachAppender(appender);
        }

        assertTrue(appender.list.stream()
            .anyMatch(event -> event.getFormattedMessage().contains("[REDACTED]")));
        for (ILoggingEvent event : appender.list) {
            assertFalse(event.getFormattedMessage().contains(token),
                event.getFormattedMessage());
        }
    }

    @Test
    void postPublishFailureAfterASuccessfulPrSendsBothEvidenceFields() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new AssertionError("publish evidence store exploded"))
            .when(apiService).recordHarnessPublish(
                "run-1", null, "https://github.com/owner/repo/pull/7");

        processor.processTicket(ticket());

        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), eq("abc1234"),
            eq("https://github.com/owner/repo/pull/7"));
        verify(apiService, never()).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void retryDelayPinsAtTheMaximumAfterConfiguredAttempts() {
        assertEquals(1_000, HarnessTicketProcessor.retryDelayMillis(1, 3, 1_000, 10_000));
        assertEquals(2_000, HarnessTicketProcessor.retryDelayMillis(2, 3, 1_000, 10_000));
        assertEquals(10_000, HarnessTicketProcessor.retryDelayMillis(3, 3, 1_000, 10_000));
        assertEquals(10_000, HarnessTicketProcessor.retryDelayMillis(4, 3, 1_000, 10_000));
    }

    @Test
    void retryExhaustionIsTerminalAndLeavesTheTicketForRecovery() throws Exception {
        when(apiService.startHarnessRun(
            eq(1L), eq("vibecode/ticket-1-add-filtering"), isNull(),
            eq("opencode-go"), eq("beam-free"), anyInt()))
            .thenReturn(Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.releaseHarnessTicket("run-1")).thenReturn(true);
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));

        Field maxField = HarnessTicketProcessor.class.getDeclaredField("maxAttempts");
        maxField.setAccessible(true);
        int maxAttempts = (int) maxField.get(processor);

        for (int i = 0; i < maxAttempts; i++) {
            if (i > 0) {
                clearBackoff(1L);
            }
            processor.processTicket(ticket());
        }

        verify(apiService, times(maxAttempts)).pickUpTicket(1L);
        verify(apiService, times(maxAttempts - 1)).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
        verify(apiService, times(1)).finishHarnessRun(
            eq("run-1"), eq("dead_letter"), anyString(), isNull(), isNull());

        ArgumentCaptor<String> messages = ArgumentCaptor.forClass(String.class);
        verify(apiService, atLeastOnce()).postMessage(eq(1L), eq("update"), messages.capture());
        assertTrue(messages.getAllValues().stream()
            .anyMatch(message -> message.contains("marked dead_letter")));

        // A terminal ticket that reappears in the backlog is skipped instead of
        // consuming another cycle.
        processor.processTicket(ticket());
        verify(apiService, times(maxAttempts)).pickUpTicket(1L);
    }

    @Test
    void anOperatorDeadLetterIsNeverUndoneByTheAgentFailurePath() throws Exception {
        when(apiService.startHarnessRun(
            eq(1L), eq("vibecode/ticket-1-add-filtering"), isNull(),
            eq("opencode-go"), eq("beam-free"), anyInt()))
            .thenReturn(Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), isNull(), isNull()))
            .thenReturn("dead_letter");
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));

        processor.processTicket(ticket());

        verify(apiService, never()).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
        ArgumentCaptor<String> messages = ArgumentCaptor.forClass(String.class);
        verify(apiService, atLeastOnce()).postMessage(eq(1L), eq("update"), messages.capture());
        assertTrue(messages.getAllValues().stream()
            .anyMatch(message -> message.contains("already dead_letter")));
    }

    @Test
    void aDifferentActualTerminalStatusIsNotReleased() throws Exception {
        when(apiService.startHarnessRun(
            eq(1L), eq("vibecode/ticket-1-add-filtering"), isNull(),
            eq("opencode-go"), eq("beam-free"), anyInt()))
            .thenReturn(Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), isNull(), isNull()))
            .thenThrow(new IOException("finish down"))
            .thenThrow(new IOException("finish down"))
            .thenThrow(new IOException("finish down"))
            .thenReturn("succeeded");
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));

        processor.processTicket(ticket());

        verify(apiService, never()).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
        ArgumentCaptor<String> messages = ArgumentCaptor.forClass(String.class);
        verify(apiService, atLeastOnce()).postMessage(eq(1L), eq("update"), messages.capture());
        assertTrue(messages.getAllValues().stream()
            .anyMatch(message -> message.contains("already succeeded")));
    }

    private void clearBackoff(long ticketId) throws Exception {
        Field failuresField = HarnessTicketProcessor.class.getDeclaredField("failures");
        failuresField.setAccessible(true);
        Map<?, ?> failures = (Map<?, ?>) failuresField.get(processor);
        Object state = failures.get(ticketId);
        assertNotNull(state, "failure state must exist before the next attempt");
        Field nextAttemptAt = state.getClass().getDeclaredField("nextAttemptAt");
        nextAttemptAt.setAccessible(true);
        nextAttemptAt.setLong(state, 0L);
    }

    @Test
    void failedTicketIsBackedOffInsteadOfRetriedOnTheNextPoll() throws Exception {
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));

        processor.processTicket(ticket());
        processor.processTicket(ticket());

        verify(apiService, org.mockito.Mockito.times(1)).pickUpTicket(1L);
    }

    @Test
    void verificationFailurePostsOutputReleasesAndNeverPushes() throws Exception {
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult(
                "npm test", 1, "AssertionError: expected 2 but was 1", false)));

        processor.processTicket(ticket());

        verify(workspace, never()).commitAndPush(anyString(), anyString());
        verify(gitHubService, never()).createPullRequest(
            anyString(), anyString(), anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Verification failed")
                && message.contains("AssertionError")));
    }

    @Test
    void verificationFailureOutputIsRedactedBeforePosting() throws Exception {
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult(
                "npm test", 1,
                "leak secret-key and ghp_token and test-key and "
                    + "ghp_abcdefghijklmnopqrstuvwxyz012345 and "
                    + "sk-abcdefghijklmnopqrstuvwxyz012345 and "
                    + "password=super-secret",
                false)));

        processor.processTicket(ticket());

        for (String message : postedMessages()) {
            assertFalse(message.contains("secret-key"), "Leaked provider key in: " + message);
            assertFalse(message.contains("ghp_token"), "Leaked GitHub token in: " + message);
            assertFalse(message.contains("test-key"), "Leaked agent API key in: " + message);
            assertFalse(message.contains("ghp_abcdefghijklmnopqrstuvwxyz012345"),
                "Leaked GitHub-shaped token in: " + message);
            assertFalse(message.contains("sk-abcdefghijklmnopqrstuvwxyz012345"),
                "Leaked OpenAI-shaped key in: " + message);
            assertFalse(message.contains("super-secret"), "Leaked password in: " + message);
        }
    }

    @Test
    void protectedPathBlocksPublishingAndReleases() throws Exception {
        when(workspace.stageFreshDiff()).thenReturn(new DiffSummary(
            List.of(new DiffSummary.ChangedFile(".env", "modified")), 1, 0));

        processor.processTicket(ticket());

        verify(workspace, never()).commitAndPush(anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Publishing blocked") && message.contains(".env")));
    }

    @Test
    void credentialInStagedDiffBlocksPublishingAndReleases() throws Exception {
        when(workspace.guardedChangedBlobs()).thenReturn(List.of(
            new WorkspaceManager.GuardedBlob(
                "README.md", "token: secret-key\n".getBytes(StandardCharsets.UTF_8),
                new byte[0], true)));

        processor.processTicket(ticket());

        verify(workspace, never()).commitAndPush(anyString(), anyString());
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Publishing blocked")
                && message.contains("configured credential")));
    }

    @Test
    void harnessStartupFailureReleasesAndCleansUp() throws Exception {
        doThrow(new IOException("server exploded")).when(harness).start(any());

        processor.processTicket(ticket());

        verify(workspace, never()).commitAndPush(anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        verify(harness).close();
        verify(workspace).cleanup();
    }

    @Test
    void providerKeyNeverAppearsInPostedMessages() throws Exception {
        doThrow(new IOException("server exploded with secret-key")).when(harness).start(any());

        processor.processTicket(ticket());

        for (String message : postedMessages()) {
            assertFalse(message.contains("secret-key"), "Leaked provider key in: " + message);
            assertFalse(message.contains("ghp_token"), "Leaked GitHub token in: " + message);
        }
    }

    @Test
    void persistsRunClaimsLeaseAndRecordsCheckpoints() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);

        processor.processTicket(ticket());

        verify(apiService).claimHarnessLease(1L, "run-1", 600);
        verify(apiService).checkpointHarnessRun(
            "run-1", "cloned", java.util.Map.of("workspacePath", tempDir.toString()));
        verify(apiService).checkpointHarnessRun(
            "run-1", "session_ready", java.util.Map.of("sessionId", "ses_test"));
        verify(apiService).checkpointHarnessRun("run-1", "prompting", java.util.Map.of());
        verify(apiService).checkpointHarnessRun("run-1", "verifying", java.util.Map.of());
        verify(apiService).checkpointHarnessRun("run-1", "publishing", java.util.Map.of());
        verify(apiService).checkpointHarnessRun(
            "run-1", "done",
            java.util.Map.of(
                "headSha", "abc1234",
                "prUrl", "https://github.com/owner/repo/pull/7"));
        verify(apiService).recordHarnessPublish("run-1", "abc1234", null);
        verify(apiService).recordHarnessPublish(
            "run-1", null, "https://github.com/owner/repo/pull/7");
        verify(apiService).finishHarnessRun(
            "run-1", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7");
    }

    @Test
    void leaseConflictSkipsCloningAndLeavesTheTicketForRecovery() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(false);

        processor.processTicket(ticket());

        verify(workspace, never()).cloneRepo(anyString(), anyString());
        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), contains("leased by another"), isNull(), isNull());
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void verificationFailureFinishesThePersistedRun() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));

        processor.processTicket(ticket());

        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), contains("Verification failed"), isNull(), isNull());
        verify(apiService).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void checkpointFailureDoesNotAbortTheRun() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new IOException("checkpoint API down"))
            .when(apiService).checkpointHarnessRun(anyString(), anyString(), any());

        processor.processTicket(ticket());

        verify(apiService).finishHarnessRun(
            "run-1", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7");
        verify(workspace).commitAndPushStaged(
            "feat: Add filtering", "vibecode/ticket-1-add-filtering");
    }

    @Test
    void leaseClaimErrorAfterRunCreationFailsClosed() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600))
            .thenThrow(new IOException("backend 500"));

        processor.processTicket(ticket());

        verify(workspace, never()).cloneRepo(anyString(), anyString());
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), contains("lease claim failed"), isNull(), isNull());
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void runGoneCheckpointBlocksPublishing() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new ApiService.RunGoneException("run was reaped"))
            .when(apiService).checkpointHarnessRun("run-1", "verifying", java.util.Map.of());

        processor.processTicket(ticket());

        verify(workspace, never()).stageFreshDiff();
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(gitHubService, never()).createPullRequest(
            anyString(), anyString(), anyString(), anyString());
        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), contains("lease lost"), isNull(), isNull());
        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void heartbeatKeepsRetryingOnTransientErrorsButStopsOnLeaseLoss() throws Exception {
        when(apiService.renewHarnessLease(1L, "run-1", 600))
            .thenThrow(new IOException("backend 500"))
            .thenReturn(false);

        assertTrue(processor.heartbeatOnce(1L, "run-1"));
        assertFalse(processor.heartbeatOnce(1L, "run-1"));

        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new ApiService.RunGoneException("reaped"))
            .when(apiService).heartbeatHarnessRun("run-1", null);
        assertFalse(processor.heartbeatOnce(1L, "run-1"));
    }

    @Test
    void successfulPublishRetriesFinishUntilTheRunIsTerminal() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.finishHarnessRun(
            "run-1", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7"))
            .thenThrow(new IOException("response lost"))
            .thenThrow(new IOException("response lost"))
            .thenReturn("succeeded");

        processor.processTicket(ticket());

        verify(workspace).commitAndPushStaged(
            "feat: Add filtering", "vibecode/ticket-1-add-filtering");
        verify(apiService, org.mockito.Mockito.times(3)).finishHarnessRun(
            "run-1", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7");
    }

    @Test
    void fatalStartErrorSkipsCloningAndLeavesTheTicketForRecovery() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenThrow(new ApiService.FatalRunException("CONFLICT: active run"));

        processor.processTicket(ticket());

        verify(workspace, never()).cloneRepo(anyString(), anyString());
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(apiService, never()).claimHarnessLease(any(), anyString(), org.mockito.ArgumentMatchers.anyInt());
        verify(apiService, never()).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Could not start a durable harness run")
                && message.contains("CONFLICT: active run")
                && message.contains("no new run was started")));
    }

    @Test
    void leaseExpiryBeforePublishStopsThePush() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(false);

        processor.processTicket(ticket());

        verify(workspace, never()).stageFreshDiff();
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(gitHubService, never()).createPullRequest(
            anyString(), anyString(), anyString(), anyString());
        verify(apiService).finishHarnessRun(
            eq("run-1"), eq("failed"), contains("lease lost"), isNull(), isNull());
    }

    @Test
    void finishFailureDoesNotReleaseTheTicket() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));
        when(apiService.finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), isNull(), isNull()))
            .thenThrow(new IOException("finish API down"));

        processor.processTicket(ticket());

        verify(apiService, never()).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("leaving the ticket assigned for recovery")));
    }

    @Test
    void successFinishFailureNeverResetsAReviewedTicket() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.renewHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(apiService.finishHarnessRun(
            "run-1", "succeeded", null, "abc1234",
            "https://github.com/owner/repo/pull/7"))
            .thenThrow(new IOException("finish API down"));

        processor.processTicket(ticket());

        verify(apiService).updateTicketStatus(1L, "review");
        verify(apiService, never()).releaseTicket(1L);
        verify(apiService, never()).finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), any(), any());
        ArgumentCaptor<String> errorCaptor = ArgumentCaptor.forClass(String.class);
        verify(apiService, atLeastOnce()).finishHarnessRun(
            eq("run-1"), eq("succeeded"), errorCaptor.capture(),
            eq("abc1234"), eq("https://github.com/owner/repo/pull/7"));
        for (String error : errorCaptor.getAllValues()) {
            assertNull(error, "succeeded finish must not carry an error message");
        }
    }

    @Test
    void leaseLossFinishRetryNeverReleasesTheTicket() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        doThrow(new ApiService.RunGoneException("run was reaped"))
            .when(apiService).checkpointHarnessRun("run-1", "verifying", java.util.Map.of());
        when(apiService.finishHarnessRun(
            eq("run-1"), eq("failed"), contains("lease lost"), isNull(), isNull()))
            .thenThrow(new IOException("finish API down"))
            .thenThrow(new IOException("finish API down"))
            .thenThrow(new IOException("finish API down"))
            .thenReturn("failed");

        processor.processTicket(ticket());

        verify(apiService, never()).releaseTicket(1L);
    }

    @Test
    void normalFailureReleasesWithBackoffAfterFinallyFinishesTheRun() throws Exception {
        String branch = "vibecode/ticket-1-add-filtering";
        when(apiService.startHarnessRun(
            1L, branch, null, "opencode-go", "beam-free", 1))
            .thenReturn(java.util.Map.of("id", "run-1"));
        when(apiService.claimHarnessLease(1L, "run-1", 600)).thenReturn(true);
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 1, "failed", false)));
        when(apiService.finishHarnessRun(
            eq("run-1"), eq("failed"), anyString(), isNull(), isNull()))
            .thenThrow(new IOException("finish API down"))
            .thenThrow(new IOException("finish API down"))
            .thenThrow(new IOException("finish API down"))
            .thenReturn("failed");

        processor.processTicket(ticket());

        verify(apiService).releaseHarnessTicket("run-1");
        verify(apiService, never()).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Verification failed") && message.contains("attempt 1/3")));
    }

    @Test
    void workspacePruneSkipsWhenProtectedPathsAreUnavailable() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveWorkspacePaths(7L))
            .thenThrow(new IOException("backend down"));

        assertEquals(0, processor.pruneStaleWorkspaces());
        verify(workspace, never()).pruneStaleWorkspaces(any(), anyCollection());
    }

    @Test
    void workspacePruneUsesProtectedPathsFromTheBackend() throws Exception {
        when(config.getAgentId()).thenReturn("7");
        when(apiService.listActiveWorkspacePaths(7L))
            .thenReturn(List.of("/tmp/protected-workspace"));
        when(workspace.pruneStaleWorkspaces(any(), anyCollection())).thenReturn(2);
        when(workspace.pruneStaleTempDirectories(any())).thenReturn(1);

        assertEquals(3, processor.pruneStaleWorkspaces());
        verify(workspace).pruneStaleWorkspaces(
            any(), eq(List.of("/tmp/protected-workspace")));
    }

    @Test
    void dockerModeRunsVerificationInTheSandboxAndDestroysIt() throws Exception {
        SandboxHandle handle = new SandboxHandle("sandbox-1", tempDir, false, null);
        SandboxRunner sandboxRunner = mock(SandboxRunner.class);
        when(sandboxRunner.create(any())).thenReturn(handle);
        when(verificationRunner.run(eq(sandboxRunner), eq(handle), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));

        HarnessTicketProcessor dockerProcessor = dockerProcessor(sandboxRunner);
        dockerProcessor.processTicket(apiService.pickUpTicket(1L));

        verify(sandboxRunner).create(any());
        verify(verificationRunner).run(
            eq(sandboxRunner), eq(handle), eq(List.of("npm test")), any());
        verify(sandboxRunner).destroy(handle);
    }

    @Test
    void dockerSandboxCreateFailureIsFatalAndSkipsTheHarness() throws Exception {
        SandboxRunner sandboxRunner = mock(SandboxRunner.class);
        when(sandboxRunner.create(any())).thenThrow(new IOException("docker down"));

        HarnessTicketProcessor dockerProcessor = dockerProcessor(sandboxRunner);
        dockerProcessor.processTicket(apiService.pickUpTicket(1L));

        verify(harness, never()).start(any());
        verify(verificationRunner, never()).run(any(), anyList(), any());
        assertTrue(postedMessages().stream()
            .anyMatch(message -> message.contains("Sandbox creation failed")));
    }

    @Test
    void dockerModeDestroysTheSandboxBeforeStaging() throws Exception {
        SandboxHandle handle = new SandboxHandle("sandbox-1", tempDir, false, null);
        SandboxRunner sandboxRunner = mock(SandboxRunner.class);
        when(sandboxRunner.create(any())).thenReturn(handle);
        when(verificationRunner.run(eq(sandboxRunner), eq(handle), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));

        dockerProcessor(sandboxRunner).processTicket(apiService.pickUpTicket(1L));

        InOrder inOrder = inOrder(sandboxRunner, workspace);
        inOrder.verify(sandboxRunner).destroy(handle);
        inOrder.verify(workspace).stageFreshDiff();
    }

    @Test
    void dockerSandboxDestroyFailureStopsPublishing() throws Exception {
        SandboxHandle handle = new SandboxHandle("sandbox-1", tempDir, false, null);
        SandboxRunner sandboxRunner = mock(SandboxRunner.class);
        when(sandboxRunner.create(any())).thenReturn(handle);
        when(verificationRunner.run(eq(sandboxRunner), eq(handle), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));
        doThrow(new IOException("rm failed")).when(sandboxRunner).destroy(handle);

        dockerProcessor(sandboxRunner).processTicket(apiService.pickUpTicket(1L));

        verify(workspace, never()).stageFreshDiff();
        verify(workspace, never()).commitAndPushStaged(anyString(), anyString());
        verify(gitHubService, never()).createPullRequest(
            anyString(), anyString(), anyString(), anyString());
        assertTrue(postedMessages().stream()
            .anyMatch(message -> message.contains(
                "Could not destroy the sandbox before publishing")));
    }

    @Test
    void dockerSandboxDestroyIsRetriedInTheFinally() throws Exception {
        SandboxHandle handle = new SandboxHandle("sandbox-1", tempDir, false, null);
        SandboxRunner sandboxRunner = mock(SandboxRunner.class);
        when(sandboxRunner.create(any())).thenReturn(handle);
        when(verificationRunner.run(eq(sandboxRunner), eq(handle), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));
        doThrow(new IOException("first"))
            .doNothing()
            .when(sandboxRunner).destroy(handle);

        dockerProcessor(sandboxRunner).processTicket(apiService.pickUpTicket(1L));

        verify(sandboxRunner, times(2)).destroy(handle);
        verify(workspace, never()).stageFreshDiff();
    }

    @Test
    void dockerModeStartsTheBashBridgeAndPassesItToTheHarness() throws Exception {
        SandboxHandle handle = new SandboxHandle("sandbox-1", tempDir, false, null);
        SandboxRunner sandboxRunner = mock(SandboxRunner.class);
        when(sandboxRunner.create(any())).thenReturn(handle);
        when(verificationRunner.run(eq(sandboxRunner), eq(handle), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));

        AtomicReference<SandboxBashBridge> captured = new AtomicReference<>();
        SandboxConfig sandboxConfig = SandboxConfig.from(Map.of(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000"
        )::get);
        HarnessTicketProcessor dockerProcessor = new HarnessTicketProcessor(
            config, apiService, provider, gitHubService, "ghp_token",
            harnessConfig,
            repoName -> workspace,
            (ignored, bridge) -> {
                captured.set(bridge);
                assertNotNull(bridge, "docker mode must route bash through a sandbox bridge");
                assertNotNull(bridge.baseUrl(), "the bridge must be listening before the harness starts");
                return harness;
            },
            planningDocFetcher,
            verificationRunner,
            new PublishingGuard(harnessConfig.protectedPaths()),
            sandboxConfig,
            sandboxRunner
        );

        dockerProcessor.processTicket(apiService.pickUpTicket(1L));

        assertNotNull(captured.get());
        assertNull(captured.get().baseUrl(), "the bridge must be closed after the prompt");
    }

    private HarnessTicketProcessor dockerProcessor(SandboxRunner sandboxRunner) {
        SandboxConfig sandboxConfig = SandboxConfig.from(Map.of(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000"
        )::get);
        return new HarnessTicketProcessor(
            config, apiService, provider, gitHubService, "ghp_token",
            harnessConfig,
            repoName -> workspace,
            (ignored, bridge) -> harness,
            planningDocFetcher,
            verificationRunner,
            new PublishingGuard(harnessConfig.protectedPaths()),
            sandboxConfig,
            sandboxRunner
        );
    }

    private List<String> postedMessages() throws Exception {
        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);
        verify(apiService, atLeastOnce()).postMessage(any(), anyString(), captor.capture());
        return captor.getAllValues();
    }
}
