package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubService;
import com.vibecode.agent.service.WorkspaceManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
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
        "opencode", "opencode", Duration.ofSeconds(30), Duration.ofSeconds(30),
        Duration.ofMinutes(45), List.of("npm test"),
        List.of(".env*", ".github/workflows/**", "**/secrets/**"), null);

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
        when(workspace.collectDiff()).thenReturn(new DiffSummary(
            List.of(new DiffSummary.ChangedFile("src/App.java", "modified")), 12, 3));
        when(workspace.commitAndPush(anyString(), anyString())).thenReturn("abc1234");

        harness = mock(HarnessClient.class);
        when(harness.createSession(anyString())).thenReturn("ses_test");

        planningDocFetcher = mock(PlanningDocFetcher.class);
        when(planningDocFetcher.fetch(1L)).thenReturn(List.of("=== 01 ===\nRequirement"));

        verificationRunner = mock(VerificationRunner.class);
        when(verificationRunner.resolveCommands(any())).thenReturn(List.of("npm test"));
        when(verificationRunner.run(any(), anyList(), any()))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));

        processor = new HarnessTicketProcessor(
            config, apiService, provider, gitHubService, "ghp_token",
            harnessConfig,
            repoName -> workspace,
            ignored -> harness,
            planningDocFetcher,
            verificationRunner,
            new PublishingGuard(harnessConfig.protectedPaths())
        );
    }

    private Ticket ticket() {
        Ticket ticket = new Ticket();
        ticket.setId(1L);
        ticket.setTitle("Add filtering");
        ticket.setDescription("Filter tickets by status.");
        return ticket;
    }

    @Test
    void happyPathPromptsVerifiesPublishesAndSetsReview() throws Exception {
        processor.processTicket(ticket());

        verify(harness).start(tempDir);
        verify(harness).sendPrompt(eq("ses_test"), contains("Add filtering"));
        verify(verificationRunner).run(eq(tempDir), eq(List.of("npm test")), any());
        verify(workspace).commitAndPush("feat: Add filtering", "vibecode/ticket-1-add-filtering");
        verify(gitHubService).createPullRequest(
            eq("feat: Add filtering"), anyString(),
            eq("vibecode/ticket-1-add-filtering"), eq("main"));
        verify(apiService).updateTicketPrUrl(1L, "https://github.com/owner/repo/pull/7");
        verify(apiService).updateTicketStatus(1L, "review");
        verify(harness).close();
        verify(workspace).cleanup();
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
    void protectedPathBlocksPublishingAndReleases() throws Exception {
        when(workspace.collectDiff()).thenReturn(new DiffSummary(
            List.of(new DiffSummary.ChangedFile(".env", "modified")), 1, 0));

        processor.processTicket(ticket());

        verify(workspace, never()).commitAndPush(anyString(), anyString());
        verify(apiService).releaseTicket(1L);
        assertTrue(postedMessages().stream().anyMatch(message ->
            message.contains("Publishing blocked") && message.contains(".env")));
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

    private List<String> postedMessages() throws Exception {
        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);
        verify(apiService, atLeastOnce()).postMessage(any(), anyString(), captor.capture());
        return captor.getAllValues();
    }
}
