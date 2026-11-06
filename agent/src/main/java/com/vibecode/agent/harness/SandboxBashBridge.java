package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private static final String TOKEN_HEADER = "X-Sandbox-Token";

    private final SandboxRunner runner;
    private final SandboxHandle handle;
    private final List<Path> workspaceAliases;
    private final Duration maxTimeout;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String token = randomHex(32);

    private HttpServer server;
    private ExecutorService executor;
    private String baseUrl;

    SandboxBashBridge(
        SandboxRunner runner,
        SandboxHandle handle,
        Path supervisorWorkspace,
        Duration maxTimeout
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
            ExecResult result;
            try {
                result = runner.exec(handle, new ExecRequest(
                    rewritten,
                    cwd,
                    requestedTimeout(root.path("timeoutSeconds")),
                    ExecRequest.DEFAULT_MAX_OUTPUT_BYTES,
                    Map.of()
                ));
            } catch (IOException e) {
                send(exchange, 500, Map.of("error", "sandbox exec failed: " + safeMessage(e)));
                return;
            }
            send(exchange, 200, Map.of(
                "exitCode", result.exitCode(),
                "output", result.output(),
                "timedOut", result.timedOut(),
                "truncated", result.truncated()
            ));
        } catch (RuntimeException e) {
            send(exchange, 500, Map.of("error", "sandbox exec failed: " + safeMessage(e)));
        } finally {
            exchange.close();
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
