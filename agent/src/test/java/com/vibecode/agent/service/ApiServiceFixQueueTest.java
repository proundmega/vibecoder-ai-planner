package com.vibecode.agent.service;

import com.sun.net.httpserver.HttpServer;
import com.vibecode.agent.config.AgentConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * HTTP contract tests for the fix queue client (fg-32c2c2): real sockets, no
 * backend.
 */
class ApiServiceFixQueueTest {

    private record StubResponse(int status, String body) {}

    private record RecordedRequest(
        String method, String path, String query, String apiKey, String runtime, String body) {}

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
                exchange.getRequestURI().getQuery(),
                exchange.getRequestHeaders().getFirst("X-API-Key"),
                exchange.getRequestHeaders().getFirst("X-Agent-Runtime"),
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
        when(config.getRuntimeId()).thenReturn("3");
        AgentAuthManager authManager = mock(AgentAuthManager.class);
        when(authManager.ensureValidAccessToken()).thenReturn("test-agent-key");
        api = new ApiService(config, authManager);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void stub(String path, int status, String body) {
        responses.put(path, new StubResponse(status, body));
    }

    @Test
    void listsTheFixQueueForAProject() throws Exception {
        stub("/api/v1/agents/fix-queue", 200,
            "{\"success\":true,\"data\":[{\"id\":\"req-1\",\"state\":\"queued\"}]}");

        List<Map<String, Object>> queue = api.listFixQueue(5, 3);

        assertEquals(1, queue.size());
        assertEquals("req-1", queue.get(0).get("id"));
        RecordedRequest request = requests.get(0);
        assertEquals("GET", request.method());
        assertEquals("/api/v1/agents/fix-queue", request.path());
        assertEquals("projectId=5&limit=3", request.query());
        assertEquals("3", request.runtime());
        assertEquals("test-agent-key", request.apiKey());
    }

    @Test
    void listFailsOnARealError() {
        stub("/api/v1/agents/fix-queue", 500,
            "{\"success\":false,\"error\":{\"code\":\"INTERNAL\",\"message\":\"boom\"}}");
        assertThrows(java.io.IOException.class, () -> api.listFixQueue(5, 0));

        stub("/api/v1/agents/fix-queue", 403,
            "{\"success\":false,\"error\":{\"code\":\"FORBIDDEN\",\"message\":\"nope\"}}");
        assertThrows(java.io.IOException.class, () -> api.listFixQueue(5, 0));
    }

    @Test
    void listsWithoutALimitWhenItIsNotPositive() throws Exception {
        stub("/api/v1/agents/fix-queue", 200, "{\"success\":true,\"data\":[]}");

        assertTrue(api.listFixQueue(5, 0).isEmpty());
        assertEquals("projectId=5", requests.get(0).query());
    }

    @Test
    void claimsAFixRequestAndTreatsContentionAsSkip() throws Exception {
        stub("/api/v1/tickets/42/fix/claim", 200,
            "{\"success\":true,\"data\":{\"claimed\":true,\"request\":{\"id\":\"req-1\"}}}");

        Map<String, Object> claimed = api.claimFix(42, 120);

        assertNotNull(claimed);
        assertEquals(true, claimed.get("claimed"));
        assertEquals("{\"leaseSeconds\":120}", requests.get(0).body());
        assertEquals("3", requests.get(0).runtime());

        stub("/api/v1/tickets/42/fix/claim", 409,
            "{\"success\":false,\"error\":{\"code\":\"CONFLICT\","
                + "\"message\":\"Fix request is claimed by another agent\"}}");
        assertNull(api.claimFix(42, 120));

        stub("/api/v1/tickets/42/fix/claim", 404,
            "{\"success\":false,\"error\":{\"code\":\"NOT_FOUND\","
                + "\"message\":\"No active fix request for this ticket\"}}");
        assertNull(api.claimFix(42, 120));
    }

    @Test
    void claimOmitsAQuietLeaseAndFailsOnRealErrors() throws Exception {
        stub("/api/v1/tickets/42/fix/claim", 200,
            "{\"success\":true,\"data\":{\"claimed\":true}}");
        assertNotNull(api.claimFix(42, null));
        assertEquals("{}", requests.get(0).body());

        stub("/api/v1/tickets/42/fix/claim", 200,
            "{\"success\":true,\"data\":{\"claimed\":true}}");
        assertNotNull(api.claimFix(42, 0));
        assertEquals("{}", requests.get(1).body());

        stub("/api/v1/tickets/42/fix/claim", 500,
            "{\"success\":false,\"error\":{\"code\":\"INTERNAL\",\"message\":\"boom\"}}");
        assertThrows(java.io.IOException.class, () -> api.claimFix(42, 120));
    }

    @Test
    void renewsAFixLeaseAndReportsALostLease() throws Exception {
        stub("/api/v1/tickets/42/fix/renew", 200,
            "{\"success\":true,\"data\":{\"request\":{\"id\":\"req-1\"}}}");

        assertTrue(api.renewFix(42, 60));
        RecordedRequest renew = requests.get(0);
        assertEquals("POST", renew.method());
        assertEquals("/api/v1/tickets/42/fix/renew", renew.path());
        assertEquals("{\"leaseSeconds\":60}", renew.body());
        assertEquals("3", renew.runtime());
        assertEquals("test-agent-key", renew.apiKey());

        stub("/api/v1/tickets/42/fix/renew", 409,
            "{\"success\":false,\"error\":{\"code\":\"CONFLICT\","
                + "\"message\":\"Fix lease has expired; reclaim the request\"}}");
        assertFalse(api.renewFix(42, 60));

        stub("/api/v1/tickets/42/fix/renew", 404,
            "{\"success\":false,\"error\":{\"code\":\"NOT_FOUND\","
                + "\"message\":\"No claimed fix request for this ticket\"}}");
        assertFalse(api.renewFix(42, 60));

        stub("/api/v1/tickets/42/fix/renew", 500,
            "{\"success\":false,\"error\":{\"code\":\"INTERNAL\",\"message\":\"boom\"}}");
        assertThrows(java.io.IOException.class, () -> api.renewFix(42, 60));
    }

    @Test
    void renewOmitsAQuietLease() throws Exception {
        stub("/api/v1/tickets/42/fix/renew", 200,
            "{\"success\":true,\"data\":{\"request\":{\"id\":\"req-1\"}}}");

        assertTrue(api.renewFix(42, null));
        assertEquals("{}", requests.get(0).body());
        assertTrue(api.renewFix(42, 0));
        assertEquals("{}", requests.get(1).body());
    }

    @Test
    void startsAFixRunWithPurposeAndClaim() throws Exception {
        stub("/api/v1/harness/runs", 200,
            "{\"success\":true,\"data\":{\"id\":\"run-1\",\"purpose\":\"fix\"}}");

        Map<String, Object> run = api.startFixHarnessRun(
            42L, "feat/fix", "/work/repo", "anthropic", "claude", 2,
            "22222222-2222-4222-8222-222222222222", "a".repeat(40));

        assertEquals("run-1", run.get("id"));
        assertEquals("3", requests.get(0).runtime());
        assertEquals("test-agent-key", requests.get(0).apiKey());
        String body = requests.get(0).body();
        assertTrue(body.contains("\"purpose\":\"fix\""), body);
        assertTrue(body.contains("\"fixRequestId\":\"22222222-2222-4222-8222-222222222222\""), body);
        assertTrue(body.contains("\"baseSha\":\"" + "a".repeat(40) + "\""), body);
    }

    @Test
    void aBuildRunOmitsTheFixFields() throws Exception {
        stub("/api/v1/harness/runs", 200,
            "{\"success\":true,\"data\":{\"id\":\"run-1\",\"purpose\":\"build\"}}");

        api.startHarnessRun(42L, "feat/build", "/work/repo", "anthropic", "claude", 1);

        String body = requests.get(0).body();
        assertFalse(body.contains("purpose"), body);
        assertFalse(body.contains("fixRequestId"), body);
        assertFalse(body.contains("baseSha"), body);
    }

    @Test
    void startsAFixRunWithARepoProfile() throws Exception {
        stub("/api/v1/harness/runs", 200,
            "{\"success\":true,\"data\":{\"id\":\"run-1\"}}");

        api.startFixHarnessRun(42L, "feat/fix", null, "anthropic", "claude", 1,
            "22222222-2222-4222-8222-222222222222", "a".repeat(40),
            "11111111-1111-4111-8111-111111111111", 3);

        String body = requests.get(0).body();
        assertTrue(body.contains("\"repoProfileId\":\"11111111-1111-4111-8111-111111111111\""), body);
        assertTrue(body.contains("\"repoProfileVersion\":3"), body);
    }

    @Test
    void aFixRunRequiresTheClaimAndBaseSha() {
        assertThrows(IllegalArgumentException.class, () -> api.startFixHarnessRun(
            42L, "b", null, null, null, 1, " ", "a".repeat(40)));
        assertThrows(IllegalArgumentException.class, () -> api.startFixHarnessRun(
            42L, "b", null, null, null, 1,
            "22222222-2222-4222-8222-222222222222", " "));
    }
}
