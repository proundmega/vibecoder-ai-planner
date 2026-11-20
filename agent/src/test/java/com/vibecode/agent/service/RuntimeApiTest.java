package com.vibecode.agent.service;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.vibecode.agent.config.AgentConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** fg-54: node credential + runtime header contract and refresh retry. */
class RuntimeApiTest {

    private record Recorded(String method, String path, String apiKey, String runtime, String body) {}

    private HttpServer server;
    private final List<Recorded> requests = new ArrayList<>();
    private final AtomicInteger unauthorizedRemaining = new AtomicInteger(0);

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requests.add(new Recorded(
                exchange.getRequestMethod(),
                exchange.getRequestURI().getPath(),
                exchange.getRequestHeaders().getFirst("X-API-Key"),
                exchange.getRequestHeaders().getFirst("X-Agent-Runtime"),
                body));
            int code = unauthorizedRemaining.getAndUpdate(value -> Math.max(0, value - 1)) > 0 ? 401 : 200;
            respond(exchange, code, "{\"success\":true,\"data\":{\"runtimes\":[]}}");
        });
        server.start();
    }

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private RuntimeApi api(AgentConfig config, AgentAuthManager auth) {
        return new RuntimeApi(config, auth);
    }

    private AgentConfig config() {
        AgentConfig config = mock(AgentConfig.class);
        when(config.getApiUrl()).thenReturn("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1");
        return config;
    }

    @Test
    void sendsTheNodeCredentialAndRuntimeHeader() throws Exception {
        AgentAuthManager auth = mock(AgentAuthManager.class);
        when(auth.getNodeId()).thenReturn("7");
        when(auth.ensureValidAccessToken()).thenReturn("node-token");
        RuntimeApi api = api(config(), auth);

        api.fetchConfig();
        api.fetchProviderConfig("3");
        api.heartbeat("3", "running", 42);

        assertEquals("/api/v1/agent-nodes/7/config", requests.get(0).path());
        assertEquals("node-token", requests.get(0).apiKey());
        assertEquals(null, requests.get(0).runtime());

        assertEquals("/api/v1/agent-nodes/7/runtimes/3/provider-config", requests.get(1).path());
        assertEquals("3", requests.get(1).runtime());

        assertEquals("/api/v1/agent-runtimes/3/heartbeat", requests.get(2).path());
        assertEquals("3", requests.get(2).runtime());
        assertTrue(requests.get(2).body().contains("\"status\":\"running\""));
        assertTrue(requests.get(2).body().contains("\"currentProjectId\":42"));
    }

    @Test
    void declaresTheRuntimeSetAsAJsonArray() throws Exception {
        AgentAuthManager auth = mock(AgentAuthManager.class);
        when(auth.getNodeId()).thenReturn("7");
        when(auth.ensureValidAccessToken()).thenReturn("node-token");
        RuntimeApi api = api(config(), auth);

        api.declareRuntimes(List.of(Map.of(
            "name", "workers",
            "role", "worker",
            "modelRef", "acme/model",
            "count", 2)));

        Recorded request = requests.get(0);
        assertEquals("POST", request.method());
        assertEquals("/api/v1/agent-nodes/7/runtimes", request.path());
        assertTrue(request.body().contains("\"modelRef\":\"acme/model\""));
        assertTrue(request.body().contains("\"runtimes\":["));
    }

    @Test
    void refreshesOnceAndRetriesAfterA401() throws Exception {
        AgentAuthManager auth = mock(AgentAuthManager.class);
        when(auth.getNodeId()).thenReturn("7");
        when(auth.ensureValidAccessToken()).thenReturn("old-token", "new-token");
        RuntimeApi api = api(config(), auth);

        unauthorizedRemaining.set(1);

        api.fetchConfig();

        verify(auth).refreshAfterUnauthorized("old-token");
        assertEquals("new-token", requests.get(requests.size() - 1).apiKey());
    }
}
