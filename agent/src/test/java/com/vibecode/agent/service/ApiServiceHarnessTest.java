package com.vibecode.agent.service;

import com.sun.net.httpserver.HttpServer;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.harness.RedactionRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * HTTP contract tests for the durable-run client: real sockets, no backend.
 */
class ApiServiceHarnessTest {

    private record StubResponse(int status, String body) {}

    private record RecordedRequest(String method, String path, String apiKey, String body) {}

    private HttpServer server;
    private ApiService api;
    private final Map<String, StubResponse> responses = new ConcurrentHashMap<>();
    private final List<RecordedRequest> requests =
        Collections.synchronizedList(new ArrayList<>());

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String body = new String(
                exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requests.add(new RecordedRequest(
                exchange.getRequestMethod(),
                exchange.getRequestURI().getPath(),
                exchange.getRequestHeaders().getFirst("X-API-Key"),
                body
            ));

            StubResponse response = responses.getOrDefault(
                exchange.getRequestURI().getPath(),
                new StubResponse(404,
                    "{\"success\":false,\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"missing\"}}")
            );
            byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(response.status(), bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();

        AgentConfig config = mock(AgentConfig.class);
        when(config.getApiUrl())
            .thenReturn("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1");
        when(config.getAgentApiKey()).thenReturn("test-agent-key");
        api = new ApiService(config);
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
        RedactionRegistry.reset();
    }

    private void respond(String path, int status, String body) {
        responses.put(path, new StubResponse(status, body));
    }

    private RecordedRequest lastRequest() {
        return requests.get(requests.size() - 1);
    }

    private static String ok(String data) {
        return "{\"success\":true,\"data\":" + data + "}";
    }

    private static String error(String code) {
        return "{\"success\":false,\"error\":{\"code\":\"" + code
            + "\",\"message\":\"" + code + "\"}}";
    }

    @Test
    void redactsCredentialsBeforePostingTicketMessages() throws Exception {
        respond("/api/v1/tickets/1/messages", 200, ok("{}"));
        String token = "custom-provider-key-123456";
        RedactionRegistry.register(token);

        api.postMessage(1L, "update", "token=" + token);

        RecordedRequest request = lastRequest();
        assertFalse(request.body().contains(token), request.body());
        assertTrue(request.body().contains("[REDACTED]"), request.body());
    }

    @Test
    void startsARunWithTheExpectedPathBodyAndAuth() throws Exception {
        respond("/api/v1/harness/runs", 201, ok("{\"id\":\"run-1\"}"));

        Map<String, Object> run = api.startHarnessRun(
            42L, "feat/fg-33", "/tmp/ws", "anthropic", "claude", 2);

        assertEquals("run-1", run.get("id"));
        RecordedRequest request = lastRequest();
        assertEquals("POST", request.method());
        assertEquals("/api/v1/harness/runs", request.path());
        assertEquals("test-agent-key", request.apiKey());
        assertTrue(request.body().contains("\"ticketId\":42"));
        assertTrue(request.body().contains("\"branch\":\"feat/fg-33\""));
        assertTrue(request.body().contains("\"workspacePath\":\"/tmp/ws\""));
        assertTrue(request.body().contains("\"attempt\":2"));
    }

    @Test
    void classifiesStartAuthorizationErrorsAsFatal() {
        respond("/api/v1/harness/runs", 401, error("UNAUTHORIZED"));
        assertThrows(ApiService.FatalRunException.class, () ->
            api.startHarnessRun(42L, "b", null, null, null, 1));

        respond("/api/v1/harness/runs", 401, error("KEY_EXPIRED"));
        assertThrows(ApiService.FatalRunException.class, () ->
            api.startHarnessRun(42L, "b", null, null, null, 1));

        respond("/api/v1/harness/runs", 409, error("CONFLICT"));
        assertThrows(ApiService.FatalRunException.class, () ->
            api.startHarnessRun(42L, "b", null, null, null, 1));
    }

    @Test
    void classifiesStartTransportAndMissingEndpointErrorsAsBestEffort() {
        respond("/api/v1/harness/runs", 500, error("INTERNAL_ERROR"));
        IOException serverError = assertThrows(IOException.class, () ->
            api.startHarnessRun(42L, "b", null, null, null, 1));
        assertFalse(serverError instanceof ApiService.FatalRunException);

        respond("/api/v1/harness/runs", 404, error("NOT_FOUND"));
        IOException missing = assertThrows(IOException.class, () ->
            api.startHarnessRun(42L, "b", null, null, null, 1));
        assertFalse(missing instanceof ApiService.FatalRunException);
    }

    @Test
    void checkpointSendsTheContractAndMapsRunGone() throws Exception {
        respond("/api/v1/harness/runs/run-1/checkpoints", 201, ok("{}"));
        api.checkpointHarnessRun("run-1", "verifying", Map.of("files", 1));

        RecordedRequest request = lastRequest();
        assertEquals("/api/v1/harness/runs/run-1/checkpoints", request.path());
        assertTrue(request.body().contains("\"step\":\"verifying\""));
        assertTrue(request.body().contains("\"payload\":{\"files\":1}"));

        respond("/api/v1/harness/runs/run-1/checkpoints", 409, error("CONFLICT"));
        assertThrows(ApiService.RunGoneException.class, () ->
            api.checkpointHarnessRun("run-1", "done", Map.of()));
    }

    @Test
    void heartbeatAndFinishUseTheExpectedEndpoints() throws Exception {
        respond("/api/v1/harness/runs/run-1/heartbeat", 200, ok("{}"));
        api.heartbeatHarnessRun("run-1", "verifying");
        RecordedRequest heartbeat = lastRequest();
        assertEquals("/api/v1/harness/runs/run-1/heartbeat", heartbeat.path());
        assertTrue(heartbeat.body().contains("\"step\":\"verifying\""));

        respond("/api/v1/harness/runs/run-1/finish", 200,
            ok("{\"status\":\"succeeded\"}"));
        String terminal = api.finishHarnessRun(
            "run-1", "succeeded", null, "abc123", "https://example/pull/1");
        assertEquals("succeeded", terminal);
        RecordedRequest finish = lastRequest();
        assertEquals("/api/v1/harness/runs/run-1/finish", finish.path());
        assertTrue(finish.body().contains("\"status\":\"succeeded\""));
        assertTrue(finish.body().contains("\"headSha\":\"abc123\""));
    }

    @Test
    void leaseClaimAndRenewDistinguishConflictFromTransientErrors() throws Exception {
        respond("/api/v1/harness/leases", 409, error("CONFLICT"));
        assertFalse(api.claimHarnessLease(42L, "run-1", 60));

        respond("/api/v1/harness/leases", 500, error("INTERNAL_ERROR"));
        assertThrows(IOException.class, () -> api.claimHarnessLease(42L, "run-1", 60));

        respond("/api/v1/harness/leases/42/renew", 409, error("CONFLICT"));
        assertFalse(api.renewHarnessLease(42L, "run-1", 60));

        respond("/api/v1/harness/leases/42/renew", 500, error("INTERNAL_ERROR"));
        assertThrows(IOException.class, () -> api.renewHarnessLease(42L, "run-1", 60));
    }

    @Test
    void recoveryListsRunsThroughTheAgentScopedPath() throws Exception {
        respond("/api/v1/harness/agents/7/runs", 200,
            ok("[{\"id\":\"run-1\",\"status\":\"running\"}]"));

        List<Map<String, Object>> runs = api.listActiveHarnessRuns(7L);

        assertEquals(1, runs.size());
        assertEquals("run-1", runs.get(0).get("id"));
        RecordedRequest request = lastRequest();
        assertEquals("GET", request.method());
        assertEquals("/api/v1/harness/agents/7/runs", request.path());
        assertEquals("test-agent-key", request.apiKey());
    }

    @Test
    void workspaceRecoveryUsesTheAgentScopedPath() throws Exception {
        respond("/api/v1/harness/agents/7/workspaces", 200,
            ok("[\"/tmp/ws\"]"));

        List<String> paths = api.listActiveWorkspacePaths(7L);

        assertEquals(List.of("/tmp/ws"), paths);
        assertEquals("/api/v1/harness/agents/7/workspaces", lastRequest().path());
    }

    @Test
    void publishEvidenceUsesTheRunPublishEndpoint() throws Exception {
        respond("/api/v1/harness/runs/run-1/publish", 200, ok("{}"));

        api.recordHarnessPublish("run-1", "abc123", null);

        RecordedRequest request = lastRequest();
        assertEquals("/api/v1/harness/runs/run-1/publish", request.path());
        assertTrue(request.body().contains("\"headSha\":\"abc123\""));
        assertFalse(request.body().contains("prUrl"));
    }

    @Test
    void reconciliationUsesTheRunReconcileEndpoint() throws Exception {
        respond("/api/v1/harness/runs/run-1/reconcile", 200,
            ok("{\"adopted\":true,\"released\":false,\"marked\":true}"));

        Map<String, Object> result = api.reconcileHarnessRun("run-1");

        assertEquals(true, result.get("adopted"));
        assertEquals("/api/v1/harness/runs/run-1/reconcile", lastRequest().path());
    }

    @Test
    void startRunIncludesTheRepoProfileRevisionWhenProvided() throws Exception {
        respond("/api/v1/harness/runs", 201, ok("{\"id\":\"run-1\"}"));

        api.startHarnessRun(
            42L, "feat/fg-39", null, "anthropic", "claude", 2,
            "11111111-1111-4111-8111-111111111111", 3);

        RecordedRequest request = lastRequest();
        assertTrue(request.body().contains(
            "\"repoProfileId\":\"11111111-1111-4111-8111-111111111111\""), request.body());
        assertTrue(request.body().contains("\"repoProfileVersion\":3"), request.body());
    }

    @Test
    void fetchesTheActiveRepoProfileForTheAgent() throws Exception {
        respond("/api/v1/projects/1/repo-profile/agent", 200, ok("""
            {"id":"11111111-1111-4111-8111-111111111111","version":3,"status":"active",
             "profile":{"schema_version":1,"verify":["npm test"],"env":{"NODE_ENV":"test"}}}
            """));

        var snapshot = api.getRepoProfile("1");

        assertEquals("11111111-1111-4111-8111-111111111111", snapshot.id());
        assertEquals(3, snapshot.version());
        assertEquals(List.of("npm test"), snapshot.profile().verify());
        RecordedRequest request = lastRequest();
        assertEquals("GET", request.method());
        assertEquals("/api/v1/projects/1/repo-profile/agent", request.path());
        assertEquals("test-agent-key", request.apiKey());
    }

    @Test
    void returnsNullWhenTheProjectHasNoActiveProfile() throws Exception {
        respond("/api/v1/projects/1/repo-profile/agent", 200, ok("null"));
        assertEquals(null, api.getRepoProfile("1"));
    }

    @Test
    void claimsAndFinishesRepoProfileValidations() throws Exception {
        respond("/api/v1/projects/1/repo-profile/validations/claim", 200, ok("""
            {"id":"22222222-2222-4222-8222-222222222222","profile_version":3,
             "status":"running","profile":{"schema_version":1,"verify":["npm test"]}}
            """));
        var claimed = api.claimRepoProfileValidation("1");
        assertEquals("22222222-2222-4222-8222-222222222222", claimed.id());
        assertEquals("POST", lastRequest().method());
        assertEquals("/api/v1/projects/1/repo-profile/validations/claim",
            lastRequest().path());

        respond("/api/v1/projects/1/repo-profile/validations/22222222-2222-4222-8222-222222222222/finish",
            200, ok("""
            {"id":"22222222-2222-4222-8222-222222222222","status":"succeeded"}
            """));
        var finished = api.finishRepoProfileValidation(
            "1", "22222222-2222-4222-8222-222222222222", "succeeded",
            Map.of("commands", List.of()), null);
        assertEquals("succeeded", finished.status());
        RecordedRequest request = lastRequest();
        assertEquals(
            "/api/v1/projects/1/repo-profile/validations/22222222-2222-4222-8222-222222222222/finish",
            request.path());
        assertTrue(request.body().contains("\"status\":\"succeeded\""), request.body());
        assertFalse(request.body().contains("\"error\""), request.body());
    }

    @Test
    void guardedTicketReleaseReturnsTheBackendBoolean() throws Exception {
        respond("/api/v1/harness/runs/run-1/release-ticket", 200,
            ok("{\"released\":true}"));
        assertTrue(api.releaseHarnessTicket("run-1"));
        assertEquals(
            "/api/v1/harness/runs/run-1/release-ticket", lastRequest().path());

        respond("/api/v1/harness/runs/run-1/release-ticket", 200,
            ok("{\"released\":false}"));
        assertFalse(api.releaseHarnessTicket("run-1"));
    }

    @Test
    void emitsHarnessEventsThroughTheAppendOnlyEndpoint() throws Exception {
        respond("/api/v1/harness/events", 201, ok("{\"event_id\":\"event-1\"}"));

        api.emitHarnessEvent(Map.of(
            "eventId", "event-1",
            "traceId", "trace-1",
            "runId", "run-1",
            "type", "tool.called"));

        RecordedRequest request = lastRequest();
        assertEquals("/api/v1/harness/events", request.path());
        assertTrue(request.body().contains("\"type\":\"tool.called\""));
    }

    @Test
    void capturesTheBudgetPolicyFromTheStartResponse() throws Exception {
        respond("/api/v1/harness/runs", 201,
            "{\"success\":true,\"data\":{\"id\":\"run-1\"},"
                + "\"budgetPolicy\":{\"limits\":{\"maxCostUsd\":5},"
                + "\"routing\":{\"policy\":\"free_then_paid\"}}}");

        Map<String, Object> run = api.startHarnessRun(
            42L, "feat/fg-38", null, "opencode-go", "beam-free", 1);

        assertEquals("run-1", run.get("id"));
        Map<String, Object> policy = api.getLastBudgetPolicy();
        assertNotNull(policy);
        assertEquals("free_then_paid",
            ((Map<?, ?>) policy.get("routing")).get("policy"));
    }

    @Test
    void recordsUsageSnapshotsOnTheRunScopedEndpoint() throws Exception {
        respond("/api/v1/harness/runs/run-1/usage", 201, ok("{}"));

        api.recordHarnessUsage("run-1", Map.of(
            "model", "gpt-4o", "inputTokens", 100, "outputTokens", 20));

        RecordedRequest request = lastRequest();
        assertEquals("/api/v1/harness/runs/run-1/usage", request.path());
        assertTrue(request.body().contains("\"inputTokens\":100"));

        respond("/api/v1/harness/runs/run-1/usage", 201,
            ok("{\"quotaExceeded\":true}"));
        assertTrue(api.recordHarnessUsage("run-1", Map.of("model", "gpt-4o")));
    }
}
