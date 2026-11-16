package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Loopback control channel that lets the OpenCode bash tool run commands in the
 * ticket sandbox instead of on the supervisor filesystem.
 *
 * <p>The server binds to 127.0.0.1 only and requires a per-run random token.
 * The sandbox has no route to the host, so repository processes cannot reach
 * this endpoint. Only the OpenCode process (which runs in the supervisor and
 * receives the token through its environment) can call it.</p>
 */
final class SandboxBashBridge implements AutoCloseable {

    static final int MAX_BODY_BYTES = 256 * 1024;
    private static final int MAX_STREAM_BYTES = 1024 * 1024;
    private static final String TOKEN_HEADER = "X-Sandbox-Token";
    private static final int CACHE_MAX_ENTRIES = 64;
    private static final long CACHE_TTL_MILLIS = 10 * 60 * 1000L;
    private static final int MAX_REQUEST_ID_LENGTH = 128;

    private final SandboxRunner runner;
    private final SandboxHandle handle;
    private final List<Path> workspaceAliases;
    private final Duration maxTimeout;
    private final long cacheTtlMillis;
    private final long cacheWaitGraceMillis;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String token = randomHex(32);

    private final Object cacheLock = new Object();
    private final Map<String, Flight> inFlight = new HashMap<>();
    private final LinkedHashMap<String, Completed> completed =
        new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Completed> eldest) {
                return size() > CACHE_MAX_ENTRIES;
            }
        };

    private HttpServer server;
    private ExecutorService executor;
    private String baseUrl;

    SandboxBashBridge(
        SandboxRunner runner,
        SandboxHandle handle,
        Path supervisorWorkspace,
        Duration maxTimeout
    ) {
        this(runner, handle, supervisorWorkspace, maxTimeout, CACHE_TTL_MILLIS, 5_000L);
    }

    SandboxBashBridge(
        SandboxRunner runner,
        SandboxHandle handle,
        Path supervisorWorkspace,
        Duration maxTimeout,
        long cacheTtlMillis,
        long cacheWaitGraceMillis
    ) {
        if (runner == null) {
            throw new IllegalArgumentException("Sandbox runner is required");
        }
        if (handle == null) {
            throw new IllegalArgumentException("Sandbox handle is required");
        }
        if (supervisorWorkspace == null) {
            throw new IllegalArgumentException("Supervisor workspace is required");
        }
        this.runner = runner;
        this.handle = handle;
        LinkedHashSet<Path> aliases = new LinkedHashSet<>();
        aliases.add(supervisorWorkspace.toAbsolutePath().normalize());
        aliases.add(handle.workspace().toAbsolutePath().normalize());
        this.workspaceAliases = List.copyOf(aliases);
        this.maxTimeout = maxTimeout == null || maxTimeout.isNegative() || maxTimeout.isZero()
            ? SandboxConfig.DEFAULT_EXEC_TIMEOUT
            : maxTimeout;
        this.cacheTtlMillis = Math.max(1L, cacheTtlMillis);
        this.cacheWaitGraceMillis = Math.max(0L, cacheWaitGraceMillis);
    }

    synchronized void start() throws IOException {
        if (server != null) {
            return;
        }
        HttpServer created = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        ExecutorService createdExecutor = Executors.newFixedThreadPool(2, runnable -> {
            Thread thread = new Thread(runnable, "sandbox-bash-bridge");
            thread.setDaemon(true);
            return thread;
        });
        created.createContext("/exec", this::handleExec);
        created.setExecutor(createdExecutor);
        created.start();
        this.server = created;
        this.executor = createdExecutor;
        this.baseUrl = "http://127.0.0.1:" + created.getAddress().getPort();
    }

    String baseUrl() {
        return baseUrl;
    }

    String token() {
        return token;
    }

    @Override
    public synchronized void close() {
        HttpServer running = server;
        server = null;
        baseUrl = null;
        if (running != null) {
            running.stop(0);
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private void handleExec(HttpExchange exchange) throws IOException {
        try {
            if (!"/exec".equals(exchange.getRequestURI().getPath())) {
                send(exchange, 404, Map.of("error", "not found"));
                return;
            }
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                send(exchange, 405, Map.of("error", "POST required"));
                return;
            }
            if (!tokenMatches(exchange.getRequestHeaders().getFirst(TOKEN_HEADER))) {
                send(exchange, 401, Map.of("error", "invalid bridge token"));
                return;
            }

            String body;
            try {
                body = readBody(exchange.getRequestBody());
            } catch (IOException e) {
                send(exchange, 413, Map.of("error", e.getMessage()));
                return;
            }
            JsonNode root;
            try {
                root = objectMapper.readTree(body);
            } catch (IOException e) {
                send(exchange, 400, Map.of("error", "invalid JSON body"));
                return;
            }

            String command = root.path("command").asText("");
            String denied = SandboxCommandPolicy.denyReason(command);
            if (denied != null) {
                send(exchange, 403, Map.of("error", "command denied: " + denied));
                return;
            }

            String cwd;
            try {
                cwd = mapCwd(root.path("cwd").asText(null));
            } catch (IOException e) {
                send(exchange, 403, Map.of("error", e.getMessage()));
                return;
            }

            String rewritten = rewritePaths(command);
            Duration timeout = requestedTimeout(root.path("timeoutSeconds"));
            boolean stream = root.path("stream").asBoolean(false);
            String requestId = root.path("requestId").asText("").trim();
            if (requestId.isEmpty()) {
                if (stream) {
                    startStream(exchange);
                    CachedResponse response = streamExecute(exchange, rewritten, cwd, timeout);
                    writeStreamResultQuietly(exchange, response);
                } else {
                    send(exchange, execute(rewritten, cwd, timeout));
                }
                return;
            }
            if (!requestId.matches("[A-Za-z0-9._:-]{1," + MAX_REQUEST_ID_LENGTH + "}")) {
                send(exchange, 400, Map.of("error", "invalid requestId"));
                return;
            }
            String fingerprint = fingerprint(rewritten, cwd, timeout);
            Flight flight = null;
            boolean owner = false;
            boolean conflict = false;
            CachedResponse cached = null;
            synchronized (cacheLock) {
                purgeExpired();
                Completed done = completed.get(requestId);
                if (done != null) {
                    if (!done.fingerprint.equals(fingerprint)) {
                        conflict = true;
                    } else {
                        cached = done.response;
                    }
                } else {
                    Flight existing = inFlight.get(requestId);
                    if (existing != null) {
                        if (!existing.fingerprint.equals(fingerprint)) {
                            conflict = true;
                        } else {
                            flight = existing;
                        }
                    } else {
                        flight = new Flight(fingerprint);
                        inFlight.put(requestId, flight);
                        owner = true;
                    }
                }
            }
            if (conflict) {
                send(exchange, 409, Map.of(
                    "error", "requestId was already used with a different request"));
                return;
            }
            if (cached != null) {
                if (stream) {
                    sendStreamResult(exchange, cached);
                } else {
                    send(exchange, cached);
                }
                return;
            }
            if (!owner) {
                if (stream) {
                    awaitCachedStream(exchange, flight, timeout);
                } else {
                    awaitCached(exchange, flight, timeout);
                }
                return;
            }
            if (stream) {
                executeStreamOwned(exchange, flight, requestId, fingerprint,
                    rewritten, cwd, timeout);
                return;
            }
            try {
                CachedResponse response = execute(rewritten, cwd, timeout);
                if (response.status == 200) {
                    long expiresAt = System.currentTimeMillis() + cacheTtlMillis;
                    synchronized (cacheLock) {
                        completed.put(requestId, new Completed(fingerprint, response, expiresAt));
                    }
                }
                flight.future.complete(response);
                send(exchange, response);
            } catch (RuntimeException e) {
                flight.future.completeExceptionally(e);
                throw e;
            } finally {
                synchronized (cacheLock) {
                    inFlight.remove(requestId, flight);
                }
            }
        } catch (RuntimeException e) {
            send(exchange, 500, Map.of("error", "sandbox exec failed: " + safeMessage(e)));
        } finally {
            exchange.close();
        }
    }

    /** Test seam: run the owned streaming lifecycle with a supplied exchange. */
    java.util.concurrent.CompletableFuture<CachedResponse> executeStreamForTest(
        HttpExchange exchange,
        String requestId,
        String fingerprint,
        String command,
        String cwd,
        Duration timeout
    ) {
        Flight flight = new Flight(fingerprint);
        synchronized (cacheLock) {
            inFlight.put(requestId, flight);
        }
        executeStreamOwned(exchange, flight, requestId, fingerprint, command, cwd, timeout);
        return flight.future;
    }

    /** Test seam: the cached response for a completed request, if any. */
    CachedResponse completedForTest(String requestId) {
        synchronized (cacheLock) {
            Completed completedResponse = completed.get(requestId);
            return completedResponse == null ? null : completedResponse.response;
        }
    }

    /** Test seam: whether a request is still tracked as in flight. */
    boolean inFlightForTest(String requestId) {
        synchronized (cacheLock) {
            return inFlight.containsKey(requestId);
        }
    }

    /** Test seam: whether a waiting duplicate's future is already complete. */
    boolean flightCompletedForTest(String requestId) {
        synchronized (cacheLock) {
            Flight flight = inFlight.get(requestId);
            return flight != null && flight.future.isDone();
        }
    }

    private static String fingerprint(String command, String cwd, Duration timeout) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(command.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(String.valueOf(cwd).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(Long.toString(timeout.toSeconds()).getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private CachedResponse execute(
        String rewritten,
        String cwd,
        Duration timeout
    ) {
        try {
            ExecResult result = runner.exec(handle, new ExecRequest(
                rewritten,
                cwd,
                timeout,
                ExecRequest.DEFAULT_MAX_OUTPUT_BYTES,
                Map.of()
            ));
            return new CachedResponse(200, Map.of(
                "exitCode", result.exitCode(),
                "output", result.output(),
                "timedOut", result.timedOut(),
                "truncated", result.truncated()
            ));
        } catch (IOException e) {
            return new CachedResponse(500,
                Map.of("error", "sandbox exec failed: " + safeMessage(e)));
        }
    }

    private void executeStreamOwned(
        HttpExchange exchange,
        Flight flight,
        String requestId,
        String fingerprint,
        String rewritten,
        String cwd,
        Duration timeout
    ) {
        CachedResponse response = new CachedResponse(500,
            Map.of("error", "sandbox exec failed: unknown"));
        boolean started = false;
        try {
            try {
                startStream(exchange);
                started = true;
                response = streamExecute(exchange, rewritten, cwd, timeout);
            } catch (IOException | RuntimeException e) {
                response = new CachedResponse(500,
                    Map.of("error", "sandbox exec failed: " + safeMessage(e)));
            }
            if (response.status == 200) {
                long expiresAt = System.currentTimeMillis() + cacheTtlMillis;
                synchronized (cacheLock) {
                    completed.put(requestId, new Completed(fingerprint, response, expiresAt));
                }
            }
        } finally {
            // Complete and remove the flight even when response headers could
            // not be sent, so a retry never waits on a stale future.
            flight.future.complete(response);
            try {
                if (started) {
                    writeStreamResultQuietly(exchange, response);
                }
            } finally {
                synchronized (cacheLock) {
                    inFlight.remove(requestId, flight);
                }
            }
        }
    }

    private CachedResponse streamExecute(
        HttpExchange exchange,
        String rewritten,
        String cwd,
        Duration timeout
    ) {
        int[] sent = {0};
        boolean[] truncated = {false};
        try {
            ExecResult result = runner.execStreaming(handle, new ExecRequest(
                rewritten,
                cwd,
                timeout,
                ExecRequest.DEFAULT_MAX_OUTPUT_BYTES,
                Map.of()
            ), chunk -> {
                if (chunk == null || chunk.isEmpty()) {
                    return;
                }
                sent[0] += chunk.getBytes(StandardCharsets.UTF_8).length;
                if (sent[0] > MAX_STREAM_BYTES) {
                    if (!truncated[0]) {
                        truncated[0] = true;
                        writeStreamEventQuietly(exchange, Map.of("type", "truncated"));
                    }
                    return;
                }
                writeStreamEventQuietly(exchange, Map.of(
                    "type", "chunk",
                    "data", chunk
                ));
            });
            return new CachedResponse(200, Map.of(
                "exitCode", result.exitCode(),
                "output", result.output(),
                "timedOut", result.timedOut(),
                "truncated", result.truncated()
            ));
        } catch (IOException e) {
            return new CachedResponse(500,
                Map.of("error", "sandbox exec failed: " + safeMessage(e)));
        }
    }

    private void awaitCachedStream(HttpExchange exchange, Flight flight, Duration timeout)
        throws IOException {
        try {
            CachedResponse response = flight.future.get(
                timeout.toMillis() + cacheWaitGraceMillis, TimeUnit.MILLISECONDS);
            sendStreamResult(exchange, response);
        } catch (TimeoutException e) {
            streamError(exchange, "duplicate request is still running", true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            streamError(exchange, "interrupted while waiting for the request", false);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            streamError(exchange, "sandbox exec failed: "
                + (cause == null ? "unknown" : safeMessage(cause)), false);
        }
    }

    private void sendStreamResult(HttpExchange exchange, CachedResponse response)
        throws IOException {
        startStream(exchange);
        if (response.status != 200) {
            writeStreamEvent(exchange, Map.of(
                "type", "error",
                "error", response.body.getOrDefault("error", "sandbox exec failed"),
                "retryable", false
            ));
            return;
        }
        writeStreamEvent(exchange, resultEvent(response.body));
    }

    private static Map<String, Object> resultEvent(Map<String, Object> body) {
        Map<String, Object> event = new LinkedHashMap<>(body);
        event.put("type", "result");
        return event;
    }

    private void streamError(HttpExchange exchange, String message, boolean retryable)
        throws IOException {
        startStream(exchange);
        writeStreamEvent(exchange, Map.of(
            "type", "error",
            "error", message,
            "retryable", retryable
        ));
    }

    private void startStream(HttpExchange exchange) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/x-ndjson");
        // A streaming request owns its connection for the duration of the
        // command; do not let a client pool it for a retry.
        exchange.getResponseHeaders().set("Connection", "close");
        exchange.sendResponseHeaders(200, 0);
    }

    private void writeStreamResultQuietly(HttpExchange exchange, CachedResponse response) {
        try {
            if (response.status == 200) {
                writeStreamEvent(exchange, resultEvent(response.body));
            } else {
                writeStreamEvent(exchange, Map.of(
                    "type", "error",
                    "error", response.body.getOrDefault("error", "sandbox exec failed"),
                    "retryable", false
                ));
            }
        } catch (IOException ignored) {
            // The client disconnected after the result was cached.
        }
    }

    private void writeStreamEvent(HttpExchange exchange, Map<String, ?> event)
        throws IOException {
        byte[] payload = objectMapper.writeValueAsBytes(event);
        OutputStream output = exchange.getResponseBody();
        output.write(payload);
        output.write('\n');
        output.flush();
    }

    private void writeStreamEventQuietly(HttpExchange exchange, Map<String, ?> event) {
        try {
            writeStreamEvent(exchange, event);
        } catch (IOException ignored) {
            // The client disconnected; the command still runs to completion.
        }
    }

    private void awaitCached(HttpExchange exchange, Flight flight, Duration timeout)
        throws IOException {
        try {
            CachedResponse response = flight.future.get(
                timeout.toMillis() + cacheWaitGraceMillis, TimeUnit.MILLISECONDS);
            send(exchange, response);
        } catch (TimeoutException e) {
            send(exchange, 504, Map.of("error", "duplicate request is still running"));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            send(exchange, 500, Map.of("error", "interrupted while waiting for the request"));
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            send(exchange, 500, Map.of("error", "sandbox exec failed: "
                + (cause == null ? "unknown" : safeMessage(cause))));
        }
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        completed.entrySet().removeIf(entry -> entry.getValue().expiresAt <= now);
    }

    private static String safeMessage(Throwable e) {
        String message = e == null ? null : e.getMessage();
        return message == null || message.isBlank()
            ? (e == null ? "unknown" : e.getClass().getSimpleName())
            : message;
    }

    record CachedResponse(int status, Map<String, Object> body) {
    }

    private record Completed(String fingerprint, CachedResponse response, long expiresAt) {
    }

    private static final class Flight {
        private final String fingerprint;
        private final CompletableFuture<CachedResponse> future = new CompletableFuture<>();

        private Flight(String fingerprint) {
            this.fingerprint = fingerprint;
        }
    }

    private String readBody(InputStream input) throws IOException {
        byte[] bytes = input.readNBytes(MAX_BODY_BYTES + 1);
        if (bytes.length > MAX_BODY_BYTES) {
            throw new IOException("request body exceeds " + MAX_BODY_BYTES + " bytes");
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private Duration requestedTimeout(JsonNode node) {
        if (node == null || !node.isNumber()) {
            return maxTimeout;
        }
        long seconds = node.asLong();
        if (seconds <= 0) {
            return maxTimeout;
        }
        Duration requested = Duration.ofSeconds(seconds);
        return requested.compareTo(maxTimeout) > 0 ? maxTimeout : requested;
    }

    private String mapCwd(String raw) throws IOException {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.replace('\\', '/').trim();
        for (Path alias : workspaceAliases) {
            String supervisor = alias.toString();
            if (value.equals(supervisor)) {
                return null;
            }
            if (value.startsWith(supervisor + "/")) {
                String relative = value.substring(supervisor.length() + 1);
                return SandboxPaths.containerPath(
                    SandboxPaths.CONTAINER_WORKSPACE + "/" + relative);
            }
        }
        if (value.equals(SandboxPaths.CONTAINER_WORKSPACE)
            || value.startsWith(SandboxPaths.CONTAINER_WORKSPACE + "/")) {
            return SandboxPaths.containerPath(value);
        }
        throw new IOException("cwd is outside the sandbox workspace: " + raw);
    }

    private String rewritePaths(String command) {
        String rewritten = command;
        for (Path alias : workspaceAliases) {
            String supervisor = alias.toString();
            if (!supervisor.equals(SandboxPaths.CONTAINER_WORKSPACE)) {
                rewritten = rewritten.replace(supervisor, SandboxPaths.CONTAINER_WORKSPACE);
            }
        }
        return rewritten;
    }

    private void send(HttpExchange exchange, CachedResponse response) throws IOException {
        send(exchange, response.status, response.body);
    }

    private void send(HttpExchange exchange, int status, Map<String, ?> body) throws IOException {
        byte[] payload = objectMapper.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
    }

    private boolean tokenMatches(String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
            provided.getBytes(StandardCharsets.UTF_8),
            token.getBytes(StandardCharsets.UTF_8));
    }

    private static String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        new SecureRandom().nextBytes(value);
        StringBuilder builder = new StringBuilder(bytes * 2);
        for (byte b : value) {
            builder.append(String.format("%02x", b));
        }
        return builder.toString();
    }

    private static String safeMessage(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }
}
