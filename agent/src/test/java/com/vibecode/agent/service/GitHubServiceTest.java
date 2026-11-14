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
    private volatile int unauthorizedRequests = 0;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            queries.add(exchange.getRequestURI().getQuery());
            authHeaders.add(exchange.getRequestHeaders().getFirst("Authorization"));
            boolean unauthorized = unauthorizedRequests > 0;
            if (unauthorized) {
                unauthorizedRequests -= 1;
            }
            byte[] body = (unauthorized ? "{}" : responseBody)
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(unauthorized ? 401 : 200, body.length);
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
    void refreshesAndRetriesOnceAfterA401() throws Exception {
        unauthorizedRequests = 1;
        authHeaders.clear();
        responseBody = "[{\"number\":9,\"html_url\":\"https://github.com/owner/repo/pull/9\"}]";
        final int[] refreshes = {0};
        GitHubTokenSource source = new GitHubTokenSource() {
            @Override
            public String get() {
                return "ghs_" + (refreshes[0] + 1);
            }

            @Override
            public String refresh() {
                refreshes[0] += 1;
                return "ghs_" + (refreshes[0] + 1);
            }
        };
        GitHubService retrying = new GitHubService(
            source, "owner", "repo",
            "http://127.0.0.1:" + server.getAddress().getPort()
        );

        String url = retrying.findPullRequestUrl("vibecode/ticket-9");

        assertEquals("https://github.com/owner/repo/pull/9", url);
        assertEquals(1, refreshes[0]);
        assertEquals(List.of("token ghs_1", "token ghs_2"),
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
