package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
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
}
