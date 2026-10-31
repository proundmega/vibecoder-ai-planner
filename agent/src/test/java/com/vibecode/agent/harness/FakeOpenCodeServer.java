package com.vibecode.agent.harness;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Scripted HTTP/SSE server used by harness tests. It speaks the small subset of
 * the OpenCode API the Phase 1 client needs, so tests never start a real server.
 */
final class FakeOpenCodeServer implements AutoCloseable {

    private final HttpServer server;
    private final String password;

    private final AtomicBoolean healthy = new AtomicBoolean(true);
    private final AtomicBoolean failCreateSession = new AtomicBoolean(false);
    private final AtomicInteger createSessionCalls = new AtomicInteger();
    private final AtomicInteger deletedSessions = new AtomicInteger();
    private final AtomicReference<String> lastPrompt = new AtomicReference<>("");
    private final AtomicReference<List<String>> events = new AtomicReference<>(List.of());
    private volatile boolean closed;

    FakeOpenCodeServer() throws IOException {
        this("test-password");
    }

    FakeOpenCodeServer(String password) throws IOException {
        this.password = password;
        this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        this.server.createContext("/", this::handle);
        this.server.setExecutor(Executors.newCachedThreadPool(runnable -> {
            Thread thread = new Thread(runnable, "fake-opencode");
            thread.setDaemon(true);
            return thread;
        }));
        this.server.start();
    }

    String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    int port() {
        return server.getAddress().getPort();
    }

    void setHealthy(boolean value) {
        healthy.set(value);
    }

    void setFailCreateSession(boolean value) {
        failCreateSession.set(value);
    }

    void setEvents(List<String> value) {
        events.set(value == null ? List.of() : List.copyOf(value));
    }

    String lastPrompt() {
        return lastPrompt.get();
    }

    int createSessionCalls() {
        return createSessionCalls.get();
    }

    int deletedSessions() {
        return deletedSessions.get();
    }

    private void handle(HttpExchange exchange) {
        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();

            if ("/global/health".equals(path)) {
                if (healthy.get()) {
                    respond(exchange, 200, "{\"healthy\":true,\"version\":\"test\"}");
                } else {
                    respond(exchange, 503, "{\"healthy\":false}");
                }
                return;
            }

            if ("/session".equals(path) && "POST".equals(method)) {
                createSessionCalls.incrementAndGet();
                if (failCreateSession.get()) {
                    respond(exchange, 500, "{\"error\":\"forced failure " + password + "\"}");
                } else {
                    respond(exchange, 200, "{\"id\":\"ses_test\"}");
                }
                return;
            }

            if (path.startsWith("/session/") && path.endsWith("/message")
                && "POST".equals(method)) {
                lastPrompt.set(readBody(exchange));
                respond(exchange, 200, "{\"info\":{\"id\":\"msg_1\"}}");
                return;
            }

            if (path.startsWith("/session/") && path.endsWith("/diff")
                && "GET".equals(method)) {
                respond(exchange, 200,
                    "{\"files\":[{\"path\":\"src/App.java\",\"additions\":2,"
                        + "\"deletions\":1,\"status\":\"modified\"}]}");
                return;
            }

            if (path.startsWith("/session/") && "DELETE".equals(method)) {
                deletedSessions.incrementAndGet();
                respond(exchange, 200, "true");
                return;
            }

            if ("/event".equals(path) && "GET".equals(method)) {
                streamEvents(exchange);
                return;
            }

            respond(exchange, 404, "{\"error\":\"not found\"}");
        } catch (Exception e) {
            try {
                respond(exchange, 500, "{\"error\":\"fake server failure\"}");
            } catch (IOException ignored) {
                // Client disconnected.
            }
        }
    }

    private void streamEvents(HttpExchange exchange) throws IOException, InterruptedException {
        exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
        exchange.getResponseHeaders().add("Cache-Control", "no-cache");
        exchange.sendResponseHeaders(200, 0);
        try (OutputStream output = exchange.getResponseBody()) {
            for (String event : events.get()) {
                output.write(("data: " + event + "\n\n").getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
            long deadline = System.currentTimeMillis() + 10_000;
            while (!closed && System.currentTimeMillis() < deadline) {
                Thread.sleep(50);
            }
        }
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    @Override
    public void close() {
        closed = true;
        server.stop(0);
    }
}
