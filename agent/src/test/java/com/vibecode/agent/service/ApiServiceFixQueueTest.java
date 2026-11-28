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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * HTTP contract tests for the fix queue client (fg-32c2c2): real sockets, no
 * backend.
 */
class ApiServiceFixQueueTest {

    private record StubResponse(int status, String body) {}

    private record RecordedRequest(String method, String path, String query, String body) {}

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
    }

    @Test
    void claimsAFixRequestAndTreatsAConflictAsSkip() throws Exception {
        stub("/api/v1/tickets/42/fix/claim", 200,
            "{\"success\":true,\"data\":{\"claimed\":true,\"request\":{\"id\":\"req-1\"}}}");

        Map<String, Object> claimed = api.claimFix(42, 120);

        assertNotNull(claimed);
        assertEquals(true, claimed.get("claimed"));
        assertEquals("{\"leaseSeconds\":120}", requests.get(0).body());

        stub("/api/v1/tickets/42/fix/claim", 409,
            "{\"success\":false,\"error\":{\"code\":\"CONFLICT\","
                + "\"message\":\"Fix request is claimed by another agent\"}}");
        assertNull(api.claimFix(42, 120));
    }

    @Test
    void renewsAFixLeaseAndReportsALostLease() throws Exception {
        stub("/api/v1/tickets/42/fix/renew", 200,
            "{\"success\":true,\"data\":{\"request\":{\"id\":\"req-1\"}}}");

        assertTrue(api.renewFix(42, 60));
        assertEquals("POST", requests.get(0).method());
        assertEquals("/api/v1/tickets/42/fix/renew", requests.get(0).path());

        stub("/api/v1/tickets/42/fix/renew", 409,
            "{\"success\":false,\"error\":{\"code\":\"CONFLICT\","
                + "\"message\":\"Fix lease has expired; reclaim the request\"}}");
        assertFalse(api.renewFix(42, 60));
    }
}
