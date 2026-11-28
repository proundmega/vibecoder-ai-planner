package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.WorkspaceManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FixWorkerTest {

    private static final String SHA = "a".repeat(40);
    private static final String REPO_URL = "https://github.com/example/repo.git";

    @TempDir
    Path tempDir;

    private AgentConfig config;
    private ApiService api;
    private WorkspaceManager workspace;
    private VerificationRunner verification;
    private PublishingGuard publishingGuard;
    private SecretLeakGuard secretLeakGuard;
    private PlanningDocFetcher planningDocs;
    private FakeEnv environment;
    private FakeHarness harness;
    private HarnessConfig harnessConfig;
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-28T10:00:00Z"), ZoneOffset.UTC);

    @BeforeEach
    void setUp() throws IOException {
        config = mock(AgentConfig.class);
        when(config.isFixWorkerEnabled()).thenReturn(true);
        when(config.getProjectId()).thenReturn("7");
        SandboxConfig sandbox = mock(SandboxConfig.class);
        when(sandbox.isDocker()).thenReturn(true);
        when(config.getSandboxConfig()).thenReturn(sandbox);
        when(config.getRepoUrl()).thenReturn(REPO_URL);
        when(config.getFixLeaseSeconds()).thenReturn(2400);
        when(config.getFixMaxDurationMinutes()).thenReturn(30);

        api = mock(ApiService.class);
        when(api.renewFix(anyLong(), any())).thenReturn(true);
        when(api.startFixHarnessRun(
            anyLong(), anyString(), anyString(), any(), any(), anyInt(),
            anyString(), anyString()
        )).thenReturn(Map.of("id", "run-1"));
        when(api.listAcceptanceCriteria(42L)).thenReturn(List.of("filter works"));
        when(api.finishHarnessRun(anyString(), anyString(), any(), any(), any()))
            .thenReturn("succeeded");

        workspace = mock(WorkspaceManager.class);
        when(workspace.getRepoDir()).thenReturn(tempDir);
        when(workspace.stageFreshDiff()).thenReturn(new DiffSummary(
            List.of(new DiffSummary.ChangedFile("src/App.java", "modified")), 12, 3));
        when(workspace.guardedChangedBlobs()).thenReturn(List.of());
        when(workspace.commitStaged(anyString())).thenReturn("commit1");
        when(workspace.publishFastForward(anyString(), anyString(), anyString()))
            .thenReturn("commit1");

        verification = mock(VerificationRunner.class);
        when(verification.resolveInstallCommands(any())).thenReturn(List.of("npm ci"));
        when(verification.resolveCommands(any())).thenReturn(List.of("npm test"));

        publishingGuard = mock(PublishingGuard.class);
        secretLeakGuard = mock(SecretLeakGuard.class);
        planningDocs = mock(PlanningDocFetcher.class);
        when(planningDocs.fetch(42L)).thenReturn(List.of("planning: filter scope"));

        environment = new FakeEnv();
        harness = new FakeHarness();
        harnessConfig = new HarnessConfig(
            "opencode", Duration.ofSeconds(5), Duration.ofMinutes(30),
            List.of("npm test"), List.of(".env*"), null, "restart");
    }

    private FixWorker worker() {
        return new FixWorker(
            config, api, null, harnessConfig, "repo", null, null,
            planningDocs, verification, publishingGuard, secretLeakGuard,
            () -> workspace,
            repoDir -> environment,
            (tempDir, bridge) -> harness,
            clock
        );
    }

    private Map<String, Object> entry() {
        return Map.ofEntries(
            Map.entry("id", "req-1"),
            Map.entry("ticket_id", 42L),
            Map.entry("branch", "feat/filter"),
            Map.entry("reviewed_sha", SHA),
            Map.entry("review_round", 1),
            Map.entry("attempts", 0),
            Map.entry("feedback", "please fix"),
            Map.entry("title", "Add filter"),
            Map.entry("description", "Filter tickets."),
            Map.entry("status", "in_progress"),
            Map.entry("findings", List.of(Map.of(
                "severity", "critical",
                "file", "src/App.java",
                "line", 4,
                "message", "Dropped scope",
                "suggestion", "Restore the filter")))
        );
    }

    private Map<String, Object> claimData(boolean claimed) {
        return Map.of(
            "claimed", claimed,
            "request", Map.of(
                "id", "req-1",
                "ticket_id", 42L,
                "branch", "feat/filter",
                "reviewed_sha", SHA,
                "feedback", "please fix",
                "attempts", 0)
        );
    }

    private void due(Map<String, Object> entry) throws IOException {
        when(api.listFixQueue(7L, 1)).thenReturn(List.of(entry));
        when(api.claimFix(42L, 2400)).thenReturn(claimData(true));
    }

    @Test
    void doesNothingWhenTheFixWorkerIsDisabled() throws Exception {
        when(config.isFixWorkerEnabled()).thenReturn(false);

        assertEquals(0, worker().pollOnce());
        verify(api, never()).listFixQueue(anyLong(), any(Integer.class));
    }

    @Test
    void refusesHostSandboxMode() throws IOException {
        SandboxConfig host = mock(SandboxConfig.class);
        when(host.isDocker()).thenReturn(false);
        when(config.getSandboxConfig()).thenReturn(host);

        assertEquals(0, worker().pollOnce());
        verify(api, never()).listFixQueue(anyLong(), any(Integer.class));
    }

    @Test
    void doesNothingInDryRunMode() throws IOException {
        when(config.isDryRun()).thenReturn(true);

        assertEquals(0, worker().pollOnce());
        verify(api, never()).listFixQueue(anyLong(), any(Integer.class));
    }

    @Test
    void skipsWhenTheRuntimeHasNoProject() throws IOException {
        when(config.getProjectId()).thenReturn(" ");

        assertEquals(0, worker().pollOnce());
        verify(api, never()).listFixQueue(anyLong(), any(Integer.class));
    }

    @Test
    void skipsARequestAnotherRuntimeOwns() throws IOException {
        when(api.listFixQueue(7L, 1)).thenReturn(List.of(entry()));
        when(api.claimFix(42L, 2400)).thenReturn(null);

        assertEquals(0, worker().pollOnce());
        verify(api, never()).startFixHarnessRun(
            anyLong(), any(), any(), any(), any(), anyInt(), any(), any());
    }

    @Test
    void skipsARequestThisRuntimeAlreadyHolds() throws IOException {
        when(api.listFixQueue(7L, 1)).thenReturn(List.of(entry()));
        when(api.claimFix(42L, 2400)).thenReturn(claimData(false));

        assertEquals(0, worker().pollOnce());
        verify(workspace, never()).cloneExistingBranch(any(), any(), any(), any());
    }

    @Test
    void publishesAFixThroughTheProductionAdapters() throws Exception {
        due(entry());

        assertEquals(1, worker().pollOnce());

        verify(api).startFixHarnessRun(
            eq(42L), eq("feat/filter"), eq(tempDir.toString()), isNull(), isNull(),
            eq(1), eq("req-1"), eq(SHA));
        verify(workspace).cloneExistingBranch(eq(REPO_URL), eq("feat/filter"), eq(SHA), any());
        verify(publishingGuard).assertPublishable(any(DiffSummary.class));
        verify(secretLeakGuard).assertClean(any());
        verify(workspace).commitStaged(
            "fix(#42): address review feedback for Add filter");
        verify(workspace).publishFastForward("commit1", "feat/filter", SHA);
        verify(api).recordHarnessPublish("run-1", "commit1", null);
        verify(api).finishHarnessRun("run-1", "succeeded", null, "commit1", null);
        verify(workspace).cleanup();
        assertTrue(environment.closed, "the sandbox is closed after the attempt");

        String prompt = harness.prompt;
        assertTrue(prompt.contains("filter works"), prompt);
        assertTrue(prompt.contains("planning: filter scope"), prompt);
        assertTrue(prompt.contains("id=F1"), prompt);
        assertTrue(prompt.contains("please fix"), prompt);
        assertTrue(prompt.contains("Round: 1"), prompt);
        assertTrue(prompt.contains("npm test"), prompt);
        assertTrue(prompt.contains("src/App.java:4"), prompt);
        assertEquals(List.of("npm ci"), environment.installCommands);
        assertEquals(List.of("npm test"), environment.verificationCommands);
    }

    @Test
    void retriesOnceWhenThePublishAcknowledgementWasLost() throws Exception {
        due(entry());
        when(workspace.publishFastForward(anyString(), anyString(), anyString()))
            .thenThrow(new IOException("possibly_published: pushed commit1 to feat/filter"))
            .thenReturn("commit1");

        assertEquals(1, worker().pollOnce());

        verify(workspace, org.mockito.Mockito.times(2))
            .publishFastForward("commit1", "feat/filter", SHA);
        verify(api).finishHarnessRun("run-1", "succeeded", null, "commit1", null);
    }

    @Test
    void failsTheRunWhenTheGuardRejectsTheDiff() throws Exception {
        due(entry());
        doThrow(new IllegalStateException("Refusing to publish protected path: .env"))
            .when(publishingGuard).assertPublishable(any(DiffSummary.class));

        assertEquals(1, worker().pollOnce());

        verify(workspace, never()).commitStaged(anyString());
        verify(workspace, never()).publishFastForward(any(), any(), any());
        verify(api).finishHarnessRun(
            eq("run-1"), eq("failed"),
            org.mockito.ArgumentMatchers.contains("protected path"), isNull(), isNull());
        verify(workspace).cleanup();
    }

    @Test
    void refusesToPublishWithoutVerificationCommands() throws Exception {
        due(entry());
        when(verification.resolveCommands(any())).thenReturn(List.of());

        assertEquals(1, worker().pollOnce());

        verify(workspace, never()).stageFreshDiff();
        verify(api).finishHarnessRun(
            eq("run-1"), eq("failed"),
            org.mockito.ArgumentMatchers.contains("verification failed"), isNull(), isNull());
    }

    @Test
    void isolatesQueueFailuresFromTheBuildLoop() throws IOException {
        when(api.listFixQueue(7L, 1)).thenThrow(new IOException("backend down"));

        assertEquals(0, worker().pollOnce());
    }

    @Test
    void doesNotRerunARequestCompletedInThisProcess() throws Exception {
        due(entry());
        FixWorker worker = worker();

        assertEquals(1, worker.pollOnce());
        // The lease expires and the backend returns the same request as due.
        when(api.claimFix(42L, 2400)).thenReturn(claimData(true));
        assertEquals(0, worker.pollOnce());

        verify(workspace, org.mockito.Mockito.times(1))
            .publishFastForward(anyString(), anyString(), anyString());
    }

    @Test
    void mapsFindingsAndTicketsFromTheQueueRow() {
        Ticket ticket = FixWorker.ticket(entry(), 42L);
        assertEquals(42L, ticket.getId());
        assertEquals("Add filter", ticket.getTitle());
        assertEquals("in_progress", ticket.getStatus());

        List<PromptBuilder.FixFinding> findings = FixWorker.findings(entry().get("findings"));
        assertEquals(1, findings.size());
        assertEquals("F1", findings.get(0).id());
        assertEquals("critical", findings.get(0).severity());
        assertEquals("src/App.java", findings.get(0).file());
        assertEquals(4, findings.get(0).line());
        assertEquals("Restore the filter", findings.get(0).suggestion());

        assertTrue(FixWorker.findings(null).isEmpty());
        assertTrue(FixWorker.findings("not a list").isEmpty());
    }

    @Test
    void detectsAnAmbiguousPublish() {
        assertTrue(FixWorker.possiblyPublished(
            new IOException("possibly_published: pushed abc to x")));
        assertFalse(FixWorker.possiblyPublished(
            new IOException("remote_head_moved: x is at abc")));
        assertFalse(FixWorker.possiblyPublished(new IOException((String) null)));
    }

    private static final class FakeEnv implements FixWorker.Environment {
        private final List<String> installCommands = new ArrayList<>();
        private final List<String> verificationCommands = new ArrayList<>();
        private boolean closed;

        @Override
        public SandboxBashBridge bridge() {
            return null;
        }

        @Override
        public List<VerificationResult> run(List<String> commands, Duration timeout) {
            if (installCommands.isEmpty() && commands.equals(List.of("npm ci"))) {
                installCommands.addAll(commands);
            } else {
                verificationCommands.addAll(commands);
            }
            List<VerificationResult> results = new ArrayList<>();
            for (String command : commands) {
                results.add(new VerificationResult(command, 0, "ok", false));
            }
            return results;
        }

        @Override
        public void close() {
            closed = true;
        }
    }

    private static final class FakeHarness implements HarnessClient {
        private static final ObjectMapper MAPPER = new ObjectMapper();
        private Consumer<HarnessEvent> listener;
        private String prompt = "";

        @Override
        public void start(Path workspace) {
        }

        @Override
        public String createSession(String title) {
            return "ses_fix";
        }

        @Override
        public void sendPrompt(String sessionId, String prompt) {
            this.prompt = prompt;
            ObjectNode text = MAPPER.createObjectNode();
            text.put("type", "message.part.updated");
            ObjectNode part = text.putObject("properties").putObject("part");
            part.put("id", "p1");
            part.put("messageID", "msg1");
            part.put("type", "text");
            part.put("text", "done");
            listener.accept(HarnessEvent.of("message.part.updated", text));

            ObjectNode idle = MAPPER.createObjectNode();
            idle.put("type", "session.idle");
            idle.putObject("properties").put("sessionID", "ses_fix");
            listener.accept(HarnessEvent.of("session.idle", idle));
        }

        @Override
        public void subscribe(String sessionId, Consumer<HarnessEvent> listener) {
            this.listener = listener;
        }

        @Override
        public DiffSummary getDiff(String sessionId) {
            return DiffSummary.empty();
        }

        @Override
        public boolean isHealthy() {
            return true;
        }

        @Override
        public void close() {
        }
    }
}
