package com.vibecode.agent.supervisor;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-56: backend /api/health gate before enrollment/declaration/spawn. */
class BackendHealthGateTest {

    @Test
    void buildsTheApiHealthUrl() {
        assertEquals("http://api:3001/api/health",
            BackendHealthGate.healthUrl("http://api:3001"));
        assertEquals("http://api:3001/api/health",
            BackendHealthGate.healthUrl("http://api:3001/"));
    }

    @Test
    void parsesRequiredTimeoutAndInterval() {
        assertTrue(BackendHealthGate.required(null));
        assertTrue(BackendHealthGate.required("true"));
        assertFalse(BackendHealthGate.required("false"));
        assertFalse(BackendHealthGate.required("0"));
        assertEquals(Duration.ofSeconds(120), BackendHealthGate.timeout(null));
        assertEquals(Duration.ofSeconds(7), BackendHealthGate.timeout("7"));
        assertEquals(Duration.ofSeconds(120), BackendHealthGate.timeout("bad"));
        assertEquals(Duration.ofSeconds(2), BackendHealthGate.interval(null));
        assertEquals(Duration.ofMillis(500), BackendHealthGate.interval("0.5"));
    }

    @Test
    void retriesUntilTheProbeSucceeds() throws Exception {
        AtomicInteger attempts = new AtomicInteger();
        BackendHealthGate.await("test", () -> {
            if (attempts.incrementAndGet() < 3) {
                throw new IOException("not yet");
            }
        }, Duration.ofSeconds(2), Duration.ofMillis(5));

        assertEquals(3, attempts.get());
    }

    @Test
    void failsClosedAfterTheTimeout() {
        AtomicInteger attempts = new AtomicInteger();
        IOException error = assertThrows(IOException.class, () ->
            BackendHealthGate.await("test", () -> {
                attempts.incrementAndGet();
                throw new IOException("backend down");
            }, Duration.ofMillis(25), Duration.ofMillis(5)));

        assertTrue(attempts.get() >= 2);
        assertTrue(error.getMessage().contains("timed out"));
    }

    @Test
    void probesTheRealHealthEndpoint() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/health", exchange -> {
            int status = calls.incrementAndGet() == 1 ? 503 : 200;
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            BackendHealthGate.awaitHealth(base, Duration.ofSeconds(2), Duration.ofMillis(5));
            assertTrue(calls.get() >= 2);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void anExplicitOptOutSkipsTheGate() {
        assertFalse(BackendHealthGate.required("false"));
    }
}
