package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SandboxBashBridgeTest {

    @TempDir
    Path tempDir;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    private Path workspace;
    private SandboxRunner runner;
    private SandboxBashBridge bridge;

    @BeforeEach
    void setUp() throws IOException {
        workspace = Files.createDirectories(tempDir.resolve("workspace")).toRealPath();
        runner = mock(SandboxRunner.class);
        when(runner.exec(any(), any()))
            .thenReturn(new ExecResult("command", 0, "ok", false, false));
        doAnswer(invocation -> {
            java.util.function.Consumer<String> listener = invocation.getArgument(2);
            listener.accept("first");
            listener.accept("second");
            return new ExecResult("command", 0, "ok", false, false);
        }).when(runner).execStreaming(any(), any(), any());
        bridge = new SandboxBashBridge(
            runner,
            new SandboxHandle("sandbox-1", workspace, false, null),
            workspace,
            Duration.ofSeconds(60));
        bridge.start();
    }

    @AfterEach
    void tearDown() {
        HarnessPrivacyGuard.configure(null);
        bridge.close();
    }

    @Test
    void redactsSecretsAndPiiBeforeReturningCommandOutput() throws Exception {
        when(runner.exec(any(), any())).thenReturn(new ExecResult(
            "command", 0, "mail alice@example.com token sk-abcdefghijklmnopqrstuvwxyz012345",
            false, false));

        HttpResponse<String> response = exec(Map.of("command", "env"), bridge.token());

        assertEquals(200, response.statusCode());
        JsonNode body = objectMapper.readTree(response.body());
        String output = body.path("output").asText();
        assertFalse(output.contains("alice@example.com"), output);
        assertFalse(output.contains("sk-abcdefghijklmnopqrstuvwxyz012345"), output);
        assertTrue(output.contains("[REDACTED_EMAIL]"), output);
    }

    @Test
    void forwardsTheCommandAndMapsTheWorkspaceCwd() throws Exception {
        HttpResponse<String> response = exec(Map.of(
            "command", "npm test",
            "cwd", workspace.resolve("backend").toString(),
            "timeoutSeconds", 30
        ), bridge.token());

        assertEquals(200, response.statusCode());
        JsonNode body = objectMapper.readTree(response.body());
        assertEquals(0, body.path("exitCode").asInt());
        assertEquals("ok", body.path("output").asText());

        ArgumentCaptor<ExecRequest> captor = ArgumentCaptor.forClass(ExecRequest.class);
        verify(runner).exec(any(), captor.capture());
        ExecRequest request = captor.getValue();
        assertEquals("npm test", request.command());
        assertEquals("/workspace/backend", request.cwd());
        assertEquals(Duration.ofSeconds(30), request.timeout());
    }

    @Test
    void streamsChunksAndTheFinalResult() throws Exception {
        HttpResponse<String> response = exec(Map.of(
            "command", "npm install",
            "stream", true
        ), bridge.token());

        assertEquals(200, response.statusCode());
        assertTrue(response.headers().firstValue("Content-Type").orElse("")
            .startsWith("application/x-ndjson"));
        var events = events(response.body());
        assertEquals(3, events.size(), response.body());
        assertEquals("chunk", events.get(0).path("type").asText());
        assertEquals("first", events.get(0).path("data").asText());
        assertEquals("chunk", events.get(1).path("type").asText());
        assertEquals("second", events.get(1).path("data").asText());
        assertEquals("result", events.get(2).path("type").asText());
        assertEquals(0, events.get(2).path("exitCode").asInt());
        assertEquals("ok", events.get(2).path("output").asText());
        verify(runner, times(1)).execStreaming(any(), any(), any());
    }

    @Test
    void streamsACachedRequestIdAsASingleResult() throws Exception {
        Map<String, Object> body = Map.of(
            "command", "npm install",
            "requestId", "req-stream-1",
            "stream", true
        );

        HttpResponse<String> first = exec(body, bridge.token());
        assertEquals(200, first.statusCode());
        assertEquals(3, events(first.body()).size(), first.body());
        HttpResponse<String> second = exec(body, bridge.token());
        assertEquals(200, second.statusCode());
        var cached = events(second.body());
        assertEquals(1, cached.size(), second.body());
        assertEquals("result", cached.get(0).path("type").asText());
        assertEquals("ok", cached.get(0).path("output").asText());
        verify(runner, times(1)).execStreaming(any(), any(), any());
    }

    @Test
    void clearsTheFlightWhenTheStreamCannotStart() throws Exception {
        String requestId = "req-start-failure";
        HttpExchange exchange = mock(HttpExchange.class);
        when(exchange.getResponseHeaders()).thenReturn(new Headers());
        doThrow(new IOException("client disconnected before headers"))
            .when(exchange).sendResponseHeaders(anyInt(), anyLong());

        var future = bridge.executeStreamForTest(
            exchange, requestId, "fingerprint-start-failure",
            "npm install", null, Duration.ofSeconds(1));

        assertTrue(future.isDone());
        assertEquals(500, future.get().status());
        assertFalse(bridge.inFlightForTest(requestId),
            "a failed stream start must not leave a stale in-flight entry");
        verify(exchange, times(1)).sendResponseHeaders(anyInt(), anyLong());
        verify(runner, times(0)).execStreaming(any(), any(), any());
    }

    @Test
    void cachesAndCompletesBeforeAFailingFinalStreamWrite() throws Exception {
        doAnswer(invocation -> {
            Consumer<String> listener = invocation.getArgument(2);
            listener.accept("first");
            return new ExecResult("command", 0, "ok", false, false);
        }).when(runner).execStreaming(any(), any(), any());

        String requestId = "req-disconnect";
        String fingerprint = "fingerprint-disconnect";
        AtomicBoolean cachedAtFinalWrite = new AtomicBoolean(false);
        AtomicBoolean flightCompletedAtFinalWrite = new AtomicBoolean(false);
        AtomicBoolean resultWriteSeen = new AtomicBoolean(false);
        OutputStream responseBody = new OutputStream() {
            @Override
            public void write(int value) throws IOException {
                write(new byte[]{(byte) value}, 0, 1);
            }

            @Override
            public void write(byte[] bytes, int offset, int length) throws IOException {
                String payload = new String(bytes, offset, length, StandardCharsets.UTF_8);
                if (payload.contains("\"type\":\"result\"")) {
                    resultWriteSeen.set(true);
                    cachedAtFinalWrite.set(
                        bridge.completedForTest(requestId) != null);
                    flightCompletedAtFinalWrite.set(
                        bridge.flightCompletedForTest(requestId));
                    throw new IOException("client disconnected");
                }
            }
        };

        HttpExchange exchange = mock(HttpExchange.class);
        Map<String, Object> attributes = new HashMap<>();
        when(exchange.getResponseHeaders()).thenReturn(new Headers());
        when(exchange.getAttribute(anyString()))
            .thenAnswer(invocation -> attributes.get(invocation.getArgument(0)));
        doAnswer(invocation -> {
            attributes.put(invocation.getArgument(0), invocation.getArgument(1));
            return null;
        }).when(exchange).setAttribute(anyString(), any());
        doNothing().when(exchange).sendResponseHeaders(anyInt(), anyLong());
        when(exchange.getResponseBody()).thenReturn(responseBody);

        bridge.executeStreamForTest(
            exchange, requestId, fingerprint, "npm install", null, Duration.ofSeconds(1));

        assertEquals("ok", bridge.completedForTest(requestId).body().get("output"));
        assertFalse(bridge.inFlightForTest(requestId),
            "the request must leave the in-flight map even when the final write fails");
        assertTrue(resultWriteSeen.get(), "the final result write should be attempted");
        assertTrue(cachedAtFinalWrite.get(),
            "the result must be cached before the final write");
        assertTrue(flightCompletedAtFinalWrite.get(),
            "a waiting duplicate must complete before the final write");
        verify(exchange, times(1)).sendResponseHeaders(anyInt(), anyLong());
    }

    @Test
    void streamsExecutionFailuresAsErrorEvents() throws Exception {
        doThrow(new IOException("sandbox broke"))
            .when(runner).execStreaming(any(), any(), any());

        HttpResponse<String> response = exec(Map.of(
            "command", "npm install",
            "stream", true
        ), bridge.token());

        assertEquals(200, response.statusCode());
        var events = events(response.body());
        assertEquals(1, events.size(), response.body());
        assertEquals("error", events.get(0).path("type").asText());
        assertTrue(events.get(0).path("error").asText().contains("sandbox broke"),
            response.body());
        assertFalse(events.get(0).path("retryable").asBoolean(true));
    }

    @Test
    void rewritesSupervisorAbsolutePathsInTheCommand() throws Exception {
        exec(Map.of("command", "cd " + workspace + " && npm test"), bridge.token());

        ArgumentCaptor<ExecRequest> captor = ArgumentCaptor.forClass(ExecRequest.class);
        verify(runner).exec(any(), captor.capture());
        assertEquals("cd /workspace && npm test", captor.getValue().command());
    }

    @Test
    void rejectsAMissingOrWrongToken() throws Exception {
        assertEquals(401, exec(Map.of("command", "ls"), "wrong").statusCode());
        assertEquals(401, exec(Map.of("command", "ls"), null).statusCode());
    }

    @Test
    void rejectsACwdOutsideTheWorkspace() throws Exception {
        HttpResponse<String> response = exec(Map.of(
            "command", "ls",
            "cwd", tempDir.resolve("outside").toString()
        ), bridge.token());

        assertEquals(403, response.statusCode());
        assertTrue(response.body().contains("outside the sandbox workspace"));
    }

    @Test
    void rejectsDeniedCommands() throws Exception {
        HttpResponse<String> response = exec(Map.of("command", "git push origin main"),
            bridge.token());

        assertEquals(403, response.statusCode());
        assertTrue(response.body().contains("command denied"));
    }

    @Test
    void returnsA500WhenTheSandboxExecFails() throws Exception {
        when(runner.exec(any(), any())).thenThrow(new IOException("sandbox gone"));

        HttpResponse<String> response = exec(Map.of("command", "ls"), bridge.token());

        assertEquals(500, response.statusCode());
        assertTrue(response.body().contains("sandbox gone"));
    }

    @Test
    void rejectsAnOversizedBody() throws Exception {
        String oversized = "x".repeat(SandboxBashBridge.MAX_BODY_BYTES + 1024);
        HttpResponse<String> response = exec(Map.of("command", oversized), bridge.token());

        assertEquals(413, response.statusCode());
    }

    @Test
    void clampsTheRequestedTimeoutToTheSandboxMaximum() throws Exception {
        exec(Map.of("command", "sleep 1", "timeoutSeconds", 999_999), bridge.token());

        ArgumentCaptor<ExecRequest> captor = ArgumentCaptor.forClass(ExecRequest.class);
        verify(runner).exec(any(), captor.capture());
        assertEquals(Duration.ofSeconds(60), captor.getValue().timeout());
    }

    @Test
    void refusesNonPostRequests() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(bridge.baseUrl() + "/exec"))
            .header("X-Sandbox-Token", bridge.token())
            .GET()
            .build();
        HttpResponse<String> response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        assertEquals(405, response.statusCode());
    }

    @Test
    void returnsTheCachedResultForADuplicateRequestId() throws Exception {
        Map<String, Object> request = Map.of(
            "requestId", "req-1",
            "command", "ls",
            "timeoutSeconds", 10
        );

        HttpResponse<String> first = exec(request, bridge.token());
        HttpResponse<String> second = exec(request, bridge.token());

        assertEquals(200, first.statusCode());
        assertEquals(200, second.statusCode());
        assertEquals(first.body(), second.body());
        verify(runner, times(1)).exec(any(), any());
    }

    @Test
    void rejectsReusingARequestIdWithADifferentCommand() throws Exception {
        exec(Map.of("requestId", "req-2", "command", "ls"), bridge.token());

        HttpResponse<String> conflict = exec(
            Map.of("requestId", "req-2", "command", "pwd"), bridge.token());

        assertEquals(409, conflict.statusCode());
        assertTrue(conflict.body().contains("different request"));
        verify(runner, times(1)).exec(any(), any());
    }

    @Test
    void executesAgainWhenRequestIdIsMissingForCompatibility() throws Exception {
        exec(Map.of("command", "ls"), bridge.token());
        exec(Map.of("command", "ls"), bridge.token());

        verify(runner, times(2)).exec(any(), any());
    }

    @Test
    void rejectsAnInvalidRequestId() throws Exception {
        HttpResponse<String> response = exec(
            Map.of("requestId", "bad id!", "command", "ls"), bridge.token());

        assertEquals(400, response.statusCode());
        assertTrue(response.body().contains("invalid requestId"));
        verify(runner, times(0)).exec(any(), any());
    }

    @Test
    void rejectsRequestIdReuseWithADifferentCwdOrTimeout() throws Exception {
        exec(Map.of("requestId", "req-cwd", "command", "ls"), bridge.token());
        HttpResponse<String> cwd = exec(Map.of(
            "requestId", "req-cwd",
            "command", "ls",
            "cwd", workspace.resolve("backend").toString()), bridge.token());
        assertEquals(409, cwd.statusCode());

        exec(Map.of("requestId", "req-timeout", "command", "ls"), bridge.token());
        HttpResponse<String> timeout = exec(Map.of(
            "requestId", "req-timeout",
            "command", "ls",
            "timeoutSeconds", 30), bridge.token());
        assertEquals(409, timeout.statusCode());
    }

    @Test
    void doesNotCacheExecFailures() throws Exception {
        when(runner.exec(any(), any()))
            .thenThrow(new IOException("sandbox gone"))
            .thenReturn(new ExecResult("command", 0, "ok", false, false));

        Map<String, Object> request = Map.of("requestId", "req-fail", "command", "ls");
        HttpResponse<String> first = exec(request, bridge.token());
        HttpResponse<String> second = exec(request, bridge.token());

        assertEquals(500, first.statusCode());
        assertEquals(200, second.statusCode());
        verify(runner, times(2)).exec(any(), any());
    }

    @Test
    void enforcesTheRequestIdLengthBoundary() throws Exception {
        HttpResponse<String> accepted = exec(Map.of(
            "requestId", "a".repeat(128), "command", "ls"), bridge.token());
        HttpResponse<String> rejected = exec(Map.of(
            "requestId", "a".repeat(129), "command", "ls"), bridge.token());

        assertEquals(200, accepted.statusCode());
        assertEquals(400, rejected.statusCode());
    }

    @Test
    void waitsForAnInFlightDuplicate() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(runner.exec(any(), any())).thenAnswer(invocation -> {
            started.countDown();
            release.await(5, TimeUnit.SECONDS);
            return new ExecResult("command", 0, "ok", false, false);
        });
        Map<String, Object> request = Map.of(
            "requestId", "req-in-flight",
            "command", "ls",
            "timeoutSeconds", 10);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<HttpResponse<String>> first = CompletableFuture.supplyAsync(
                () -> {
                    try {
                        return exec(request, bridge.token());
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }, executor);
            assertTrue(started.await(5, TimeUnit.SECONDS));
            CompletableFuture<HttpResponse<String>> second = CompletableFuture.supplyAsync(
                () -> {
                    try {
                        return exec(request, bridge.token());
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }, executor);
            release.countDown();
            assertEquals(200, first.get(5, TimeUnit.SECONDS).statusCode());
            assertEquals(200, second.get(5, TimeUnit.SECONDS).statusCode());
            verify(runner, times(1)).exec(any(), any());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void evictsTheOldestCacheEntryAtTheBound() throws Exception {
        for (int i = 0; i < 65; i++) {
            assertEquals(200, exec(Map.of(
                "requestId", "req-" + i, "command", "ls"), bridge.token()).statusCode());
        }
        // req-0 was evicted, so this executes again rather than returning a cache hit.
        assertEquals(200, exec(Map.of(
            "requestId", "req-0", "command", "ls"), bridge.token()).statusCode());

        verify(runner, times(66)).exec(any(), any());
    }

    @Test
    void expiresTheCacheAfterTheTtl() throws Exception {
        SandboxBashBridge shortTtl = new SandboxBashBridge(
            runner,
            new SandboxHandle("sandbox-1", workspace, false, null),
            workspace,
            Duration.ofSeconds(60),
            50L,
            5_000L);
        shortTtl.start();
        try {
            Map<String, Object> request = Map.of("requestId", "req-ttl", "command", "ls");
            assertEquals(200, exec(shortTtl, request).statusCode());
            Thread.sleep(100);
            assertEquals(200, exec(shortTtl, request).statusCode());
            verify(runner, times(2)).exec(any(), any());
        } finally {
            shortTtl.close();
        }
    }

    @Test
    void returns504WhenAnInFlightDuplicateExceedsTheWaitGrace() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(runner.exec(any(), any())).thenAnswer(invocation -> {
            started.countDown();
            release.await(5, TimeUnit.SECONDS);
            return new ExecResult("command", 0, "ok", false, false);
        });
        SandboxBashBridge impatient = new SandboxBashBridge(
            runner,
            new SandboxHandle("sandbox-1", workspace, false, null),
            workspace,
            Duration.ofSeconds(1),
            60_000L,
            100L);
        impatient.start();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        Map<String, Object> request = Map.of(
            "requestId", "req-slow",
            "command", "ls",
            "timeoutSeconds", 1);
        try {
            CompletableFuture<HttpResponse<String>> first = CompletableFuture.supplyAsync(
                () -> {
                    try {
                        return exec(impatient, request);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }, executor);
            assertTrue(started.await(5, TimeUnit.SECONDS));
            CompletableFuture<HttpResponse<String>> second = CompletableFuture.supplyAsync(
                () -> {
                    try {
                        return exec(impatient, request);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }, executor);
            assertEquals(504, second.get(5, TimeUnit.SECONDS).statusCode());
            release.countDown();
            assertEquals(200, first.get(5, TimeUnit.SECONDS).statusCode());
        } finally {
            release.countDown();
            executor.shutdownNow();
            impatient.close();
        }
    }

    @Test
    void toolRetryUsesTheBridgeCacheAfterALostResponse() throws Exception {
        Assumptions.assumeTrue(nodeAvailable(), "node is required");
        Path dir = Files.createDirectories(tempDir.resolve("tool-bridge-retry"));
        Files.writeString(dir.resolve("tool.mjs"), OpenCodeClient.sandboxToolSource());
        Path plugin = Files.createDirectories(
            dir.resolve("node_modules/@opencode-ai/plugin"));
        Files.writeString(plugin.resolve("package.json"),
            "{\"type\":\"module\",\"exports\":\"./index.js\"}");
        Files.writeString(plugin.resolve("index.js"), """
            const schema = () => ({
              describe: () => schema(),
              int: () => schema(),
              positive: () => schema(),
              optional: () => schema(),
            });
            export const tool = (definition) => definition;
            tool.schema = { string: schema, number: schema };
            """);
        Path harness = dir.resolve("run.mjs");
        Files.writeString(harness, """
            const { default: tool } = await import("./tool.mjs");
            const realFetch = globalThis.fetch;
            let calls = 0;
            const ids = [];
            globalThis.fetch = async (url, options) => {
              calls++;
              ids.push(JSON.parse(options.body).requestId);
              const response = await realFetch(url, options);
              if (calls === 1) {
                throw new Error("response lost");
              }
              return response;
            };
            const result = await tool.execute(
              { command: "echo hi", timeoutSeconds: 5 },
              { directory: "/workspace" });
            console.log(JSON.stringify({ calls, ids, result }));
            """);

        ProcessBuilder builder = new ProcessBuilder("node", harness.toString())
            .redirectErrorStream(true);
        builder.environment().put("VIBECODE_SANDBOX_BRIDGE_URL", bridge.baseUrl());
        builder.environment().put("VIBECODE_SANDBOX_BRIDGE_TOKEN", bridge.token());
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(),
            StandardCharsets.UTF_8);
        assertEquals(0, process.waitFor(), output);
        JsonNode json = objectMapper.readTree(output.trim());
        assertEquals(2, json.path("calls").asInt(), output);
        assertEquals(json.path("ids").get(0).asText(),
            json.path("ids").get(1).asText(), output);
        assertEquals("ok", json.path("result").asText(), output);
        verify(runner, times(1)).execStreaming(any(), any(), any());
    }

    private java.util.List<JsonNode> events(String body) throws IOException {
        java.util.List<JsonNode> events = new java.util.ArrayList<>();
        for (String line : body.split("\\R")) {
            if (!line.isBlank()) {
                events.add(objectMapper.readTree(line));
            }
        }
        return events;
    }

    private HttpResponse<String> exec(SandboxBashBridge target, Map<String, ?> body)
        throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(target.baseUrl() + "/exec"))
            .header("Content-Type", "application/json")
            .header("X-Sandbox-Token", target.token())
            .POST(HttpRequest.BodyPublishers.ofString(
                objectMapper.writeValueAsString(body), StandardCharsets.UTF_8))
            .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> exec(Map<String, ?> body, String token) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
            .uri(URI.create(bridge.baseUrl() + "/exec"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(
                objectMapper.writeValueAsString(body), StandardCharsets.UTF_8));
        if (token != null) {
            builder.header("X-Sandbox-Token", token);
        }
        return httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static boolean nodeAvailable() {
        try {
            Process process = new ProcessBuilder("node", "--version")
                .redirectErrorStream(true)
                .start();
            process.getInputStream().readAllBytes();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }
}
