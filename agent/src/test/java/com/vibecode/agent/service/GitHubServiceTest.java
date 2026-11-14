package com.vibecode.agent.service;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GitHubServiceTest {

    private HttpServer server;
    private GitHubService service;
    private final List<String> queries = Collections.synchronizedList(new ArrayList<>());
    private final List<String> authHeaders = Collections.synchronizedList(new ArrayList<>());
    private volatile String responseBody = "[]";

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            queries.add(exchange.getRequestURI().getQuery());
            authHeaders.add(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        service = new GitHubService(
            "token", "owner", "repo",
            "http://127.0.0.1:" + server.getAddress().getPort()
        );
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void recoveryLooksUpOnlyOpenPullRequests() throws Exception {
        responseBody = "[{\"number\":7,\"html_url\":\"https://github.com/owner/repo/pull/7\"}]";

        String url = service.findPullRequestUrl("vibecode/ticket-1");

        assertEquals("https://github.com/owner/repo/pull/7", url);
        assertEquals(1, queries.size());
        String query = queries.get(0);
        assertTrue(query.contains("state=open"));
        assertTrue(query.contains("head=owner:vibecode/ticket-1"));
    }

    @Test
    void usesTheLatestTokenFromTheSource() throws Exception {
        authHeaders.clear();
        String[] token = {"ghs_first"};
        GitHubService dynamic = new GitHubService(
            () -> token[0], "owner", "repo",
            "http://127.0.0.1:" + server.getAddress().getPort()
        );

        dynamic.findPullRequestUrl("vibecode/ticket-1");
        token[0] = "ghs_second";
        dynamic.findPullRequestUrl("vibecode/ticket-1");

        assertEquals(List.of("token ghs_first", "token ghs_second"),
            new ArrayList<>(authHeaders));
    }

    @Test
    void failsClosedWithoutACredential() {
        GitHubService unauthenticated = new GitHubService(
            () -> null, "owner", "repo",
            "http://127.0.0.1:" + server.getAddress().getPort()
        );

        assertThrows(IOException.class,
            () -> unauthenticated.findPullRequestUrl("vibecode/ticket-1"));
    }

    @Test
    void recoveryReturnsNullWhenThereIsNoOpenPullRequest() throws Exception {
        responseBody = "[]";

        assertNull(service.findPullRequestUrl("vibecode/ticket-1"));
    }
}
