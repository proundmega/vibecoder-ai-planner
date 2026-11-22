package com.vibecode.agent.supervisor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;

/**
 * fg-56: require the backend {@code /api/health} endpoint before the supervisor
 * enrolls, declares runtimes or spawns a child.
 *
 * <p>The gate is startup-only. Compose owns process restarts; the existing
 * declaration/retry loop owns post-start recovery.</p>
 */
final class BackendHealthGate {

    static final long DEFAULT_TIMEOUT_SECONDS = 120;
    static final long DEFAULT_INTERVAL_MILLIS = 2_000;
    static final String HEALTH_PATH = "/api/health";

    private static final Logger log = LoggerFactory.getLogger(BackendHealthGate.class);
    private static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    private BackendHealthGate() {
    }

    @FunctionalInterface
    interface Prober {
        void probe() throws IOException;
    }

    static String healthUrl(String backendUrl) {
        String base = backendUrl == null ? "" : backendUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + HEALTH_PATH;
    }

    static boolean required(String value) {
        if (value == null || value.isBlank()) {
            return true;
        }
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT);
        return !(normalized.equals("false") || normalized.equals("0")
            || normalized.equals("no") || normalized.equals("off"));
    }

    static Duration timeout(String value) {
        if (value == null || value.isBlank()) {
            return Duration.ofSeconds(DEFAULT_TIMEOUT_SECONDS);
        }
        try {
            long seconds = Long.parseLong(value.trim());
            return seconds > 0 ? Duration.ofSeconds(seconds)
                : Duration.ofSeconds(DEFAULT_TIMEOUT_SECONDS);
        } catch (NumberFormatException e) {
            return Duration.ofSeconds(DEFAULT_TIMEOUT_SECONDS);
        }
    }

    static Duration interval(String value) {
        if (value == null || value.isBlank()) {
            return Duration.ofMillis(DEFAULT_INTERVAL_MILLIS);
        }
        try {
            double seconds = Double.parseDouble(value.trim());
            return seconds > 0
                ? Duration.ofMillis(Math.max(1, Math.round(seconds * 1000)))
                : Duration.ofMillis(DEFAULT_INTERVAL_MILLIS);
        } catch (NumberFormatException e) {
            return Duration.ofMillis(DEFAULT_INTERVAL_MILLIS);
        }
    }

    static void awaitHealth(String backendUrl, Duration timeout, Duration interval)
        throws IOException {
        String url = healthUrl(backendUrl);
        await(url, () -> probe(url), timeout, interval);
    }

    static void await(String label, Prober prober, Duration timeout, Duration interval)
        throws IOException {
        Duration wait = timeout == null || timeout.isNegative() || timeout.isZero()
            ? Duration.ofSeconds(DEFAULT_TIMEOUT_SECONDS)
            : timeout;
        Duration pause = interval == null || interval.isNegative() || interval.isZero()
            ? Duration.ofMillis(DEFAULT_INTERVAL_MILLIS)
            : interval;
        Instant deadline = Instant.now().plus(wait);
        IOException last = null;
        int attempt = 0;
        while (true) {
            attempt++;
            try {
                prober.probe();
                log.info("Backend health gate passed: {}", label);
                return;
            } catch (IOException e) {
                last = e;
                log.debug("Backend health check attempt {} failed for {}: {}",
                    attempt, label, e.getMessage());
            } catch (RuntimeException e) {
                last = new IOException(e.getMessage(), e);
                log.debug("Backend health check attempt {} failed for {}: {}",
                    attempt, label, e.getMessage());
            }
            Instant now = Instant.now();
            if (!now.isBefore(deadline)) {
                break;
            }
            long remaining = Duration.between(now, deadline).toMillis();
            long sleep = Math.min(remaining, pause.toMillis());
            try {
                Thread.sleep(Math.max(1, sleep));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Backend health gate interrupted for " + label, e);
            }
        }
        log.warn("Backend health gate timed out after {}s for {}", wait.toSeconds(), label);
        throw new IOException(
            "Backend health gate timed out after " + wait.toSeconds() + "s for " + label,
            last);
    }

    private static void probe(String url) throws IOException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build();
        HttpResponse<Void> response;
        try {
            response = CLIENT.send(request, HttpResponse.BodyHandlers.discarding());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Backend health check interrupted", e);
        } catch (IOException e) {
            throw new IOException("Backend health check failed: " + e.getMessage(), e);
        }
        int status = response.statusCode();
        if (status < 200 || status >= 300) {
            throw new IOException("Backend health returned HTTP " + status);
        }
    }
}
