package com.vibecode.agent.supervisor;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-56 slice B: continuous post-start health monitoring. */
class BackendHealthMonitorTest {

    @Test
    void parsesMonitorSettingsAndBoundsBackoff() {
        assertTrue(BackendHealthMonitor.enabled(null));
        assertFalse(BackendHealthMonitor.enabled("false"));
        assertEquals(Duration.ofSeconds(10), BackendHealthMonitor.interval(null));
        assertEquals(Duration.ofSeconds(60), BackendHealthMonitor.maxBackoff(null));
        assertEquals(Duration.ofSeconds(20),
            BackendHealthMonitor.nextBackoff(Duration.ofSeconds(10), Duration.ofSeconds(60)));
        assertEquals(Duration.ofSeconds(60),
            BackendHealthMonitor.nextBackoff(Duration.ofSeconds(40), Duration.ofSeconds(60)));
    }

    @Test
    void startsHealthyAndDetectsAnOutageAndRecovery() throws Exception {
        AtomicBoolean healthyResponse = new AtomicBoolean(true);
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/health", exchange -> {
            calls.incrementAndGet();
            int status = healthyResponse.get() ? 200 : 503;
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();

        try (BackendHealthMonitor monitor = new BackendHealthMonitor(
            base, Duration.ofMillis(10), Duration.ofMillis(40))) {
            monitor.start();
            waitFor(() -> monitor.isHealthy(), true);

            healthyResponse.set(false);
            waitFor(() -> monitor.isHealthy(), false);

            healthyResponse.set(true);
            waitFor(() -> monitor.isHealthy(), true);
            assertTrue(calls.get() >= 2);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void aDisabledMonitorNeverProbes() throws Exception {
        try (BackendHealthMonitor monitor = BackendHealthMonitor.disabled()) {
            monitor.start();
            assertTrue(monitor.isHealthy());
        }
    }

    @Test
    void rejectsANullBackendUrl() {
        assertThrows(IllegalArgumentException.class, () ->
            new BackendHealthMonitor(" ", Duration.ofSeconds(1), Duration.ofSeconds(1)));
    }

    private static void waitFor(java.util.function.BooleanSupplier condition, boolean expected)
        throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean() == expected) return;
            Thread.sleep(10);
        }
        assertEquals(expected, condition.getAsBoolean());
    }
}
