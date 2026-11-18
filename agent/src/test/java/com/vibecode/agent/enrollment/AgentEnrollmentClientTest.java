package com.vibecode.agent.enrollment;

import com.sun.net.httpserver.HttpServer;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.AgentCredentialStore;
import com.vibecode.agent.service.AgentEnrollmentClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AgentEnrollmentClientTest {

    private HttpServer server;

    static class UrlConfig extends AgentConfig {
        String enrollUrl;
        String refreshUrl;

        @Override public boolean usesEnrollment() { return true; }
        @Override public String getEnrollmentUrl() { return enrollUrl; }
        @Override public String getRefreshUrl() { return refreshUrl; }
        @Override public String getEnrollmentToken() { return "enr_once"; }
    }

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    private HttpServer start(String responseJson) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/enroll", exchange -> respond(exchange, responseJson));
        server.createContext("/refresh", exchange -> respond(exchange, responseJson));
        server.start();
        return server;
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private String credentialJson() {
        return "{\"success\":true,\"data\":{"
            + "\"agent_id\":42,"
            + "\"access_token\":\"at_new\","
            + "\"refresh_token\":\"ar_new\","
            + "\"access_expires_at\":\"" + Instant.parse("2026-12-01T00:00:00Z") + "\","
            + "\"refresh_expires_at\":\"" + Instant.parse("2026-12-31T00:00:00Z") + "\"}}";
    }

    @Test
    void enrollsAndParsesTheCredentialPair() throws IOException {
        HttpServer running = start(credentialJson());
        UrlConfig config = new UrlConfig();
        config.enrollUrl = "http://127.0.0.1:" + running.getAddress().getPort() + "/enroll";

        AgentCredentialStore.Credentials credentials =
            new AgentEnrollmentClient(config).enroll("worker", Map.of("hostname", "node-1"));

        assertEquals("42", credentials.agentId());
        assertEquals("at_new", credentials.accessToken());
        assertEquals("ar_new", credentials.refreshToken());
        assertEquals(Instant.parse("2026-12-01T00:00:00Z"), credentials.accessExpiresAt());
    }

    @Test
    void refreshesThroughTheRotatingEndpoint() throws IOException {
        HttpServer running = start(credentialJson());
        UrlConfig config = new UrlConfig();
        config.refreshUrl = "http://127.0.0.1:" + running.getAddress().getPort() + "/refresh";

        AgentCredentialStore.Credentials credentials =
            new AgentEnrollmentClient(config).refresh("ar_old", "idem-key-1234567890");

        assertEquals("ar_new", credentials.refreshToken());
    }

    @Test
    void refusesPlainHttpForNonLoopbackHosts() {
        UrlConfig config = new UrlConfig();
        config.enrollUrl = "http://example.com/api/v1/agent-enrollment/enroll";

        assertThrows(IOException.class,
            () -> new AgentEnrollmentClient(config).enroll("worker", Map.of()));
    }
}
