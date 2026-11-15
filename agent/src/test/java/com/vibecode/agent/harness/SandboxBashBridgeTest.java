package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
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
        bridge = new SandboxBashBridge(
            runner,
            new SandboxHandle("sandbox-1", workspace, false, null),
            workspace,
            Duration.ofSeconds(60));
        bridge.start();
    }

    @AfterEach
    void tearDown() {
        bridge.close();
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
        verify(runner, times(1)).exec(any(), any());
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
