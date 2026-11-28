package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenCodeClientTest {

    @TempDir
    Path tempDir;

    private HarnessConfig config(Duration startupTimeout) {
        return new HarnessConfig(
            
            "opencode",
            startupTimeout,
            Duration.ofMinutes(45),
            List.of(),
            List.of(".env*"),
            null,
            "restart"
        );
    }

    @Test
    void startsServerCreatesSessionAndSendsPrompt() throws Exception {
        try (FakeOpenCodeServer server = new FakeOpenCodeServer()) {
            OpenCodeClient client = new OpenCodeClient(server.url(), "password", tempDir);

            client.start(tempDir);

            assertTrue(client.isHealthy());
            assertEquals(server.port(), client.getPort());

            String session = client.createSession("ticket-1");
            assertEquals("ses_test", session);

            client.sendPrompt(session, "implement the ticket");
            assertTrue(server.lastPrompt().contains("implement the ticket"));
            assertTrue(server.lastAuthorization() != null
                    && server.lastAuthorization().startsWith("Basic "),
                "Harness requests must send the per-run basic-auth password");

            client.close();
            assertEquals(1, server.deletedSessions());
        }
    }

    @Test
    void parsesScriptedToolAndIdleEvents() throws Exception {
        try (FakeOpenCodeServer server = new FakeOpenCodeServer()) {
            server.setEvents(List.of(
                "{\"type\":\"message.part.updated\",\"properties\":"
                    + "{\"sessionID\":\"ses_test\",\"part\":{\"type\":\"tool\"}}}",
                "{\"type\":\"session.idle\",\"properties\":{\"sessionID\":\"ses_test\"}}"
            ));

            OpenCodeClient client = new OpenCodeClient(server.url(), "password", tempDir);
            client.start(tempDir);

            List<HarnessEvent> received = new CopyOnWriteArrayList<>();
            CountDownLatch latch = new CountDownLatch(2);
            client.subscribe("ses_test", event -> {
                received.add(event);
                latch.countDown();
            });

            assertTrue(latch.await(10, TimeUnit.SECONDS), "Expected scripted events");
            assertTrue(received.stream().anyMatch(HarnessEvent::isToolEvent));
            assertTrue(received.stream().anyMatch(HarnessEvent::isIdle));
            client.close();
        }
    }

    @Test
    void permissionAnswersMapToOnceAlwaysOrReject() throws Exception {
        assertEquals("once", OpenCodeClient.permissionResponse("allow"));
        assertEquals("once", OpenCodeClient.permissionResponse("yes, proceed"));
        assertEquals("always", OpenCodeClient.permissionResponse("always"));
        assertEquals("reject", OpenCodeClient.permissionResponse("reject"));
        assertEquals("reject", OpenCodeClient.permissionResponse("no"));
        // An unknown free-text answer must never approve the operation.
        assertEquals("reject", OpenCodeClient.permissionResponse("use the helper"));

        try (FakeOpenCodeServer server = new FakeOpenCodeServer()) {
            OpenCodeClient client = new OpenCodeClient(server.url(), "password", tempDir);
            client.start(tempDir);

            client.replyToQuestion("ses_test", "perm_1", "permission", "reject");
            assertEquals("{\"response\":\"reject\"}", server.lastPermissionBody());

            client.replyToQuestion("ses_test", "perm_1", "permission", "allow");
            assertEquals("{\"response\":\"once\"}", server.lastPermissionBody());

            client.replyToQuestion("ses_test", "perm_1", "permission", "always");
            assertEquals("{\"response\":\"always\"}", server.lastPermissionBody());

            assertEquals("que_1", client.findQuestionRequestId("ses_test"));
            client.replyToQuestion("ses_test", "question_1", "question", "Use the helper.");
            assertEquals("{\"answers\":[[\"Use the helper.\"]]}",
                server.lastQuestionReplyBody());
            client.close();
        }
    }

    @Test
    void healthTimeoutThrows() throws Exception {
        try (FakeOpenCodeServer server = new FakeOpenCodeServer()) {
            server.setHealthy(false);
            OpenCodeClient client = new OpenCodeClient(
                server.url(), "password", tempDir, config(Duration.ofMillis(500)));

            IOException error = assertThrows(IOException.class, () -> client.start(tempDir));

            assertTrue(error.getMessage().contains("did not become healthy"));
            client.close();
        }
    }

    @Test
    void createSessionHttpErrorIsRedacted() throws Exception {
        try (FakeOpenCodeServer server = new FakeOpenCodeServer("server-secret")) {
            server.setFailCreateSession(true);
            OpenCodeClient client = new OpenCodeClient(server.url(), "server-secret", tempDir);
            client.start(tempDir);

            IOException error = assertThrows(IOException.class,
                () -> client.createSession("ticket-1"));

            assertTrue(error.getMessage().contains("500"));
            assertFalse(error.getMessage().contains("server-secret"));
            client.close();
        }
    }

    @Test
    void sanitizeEnvironmentRemovesInheritedSecrets() {
        java.util.Map<String, String> environment = new java.util.HashMap<>();
        environment.put("PATH", "/usr/bin");
        environment.put("HOME", "/home/agent");
        environment.put("GITHUB_TOKEN", "ghp_xxx");
        environment.put("AI_API_KEY", "sk-xxx");
        environment.put("OPENCODE_API_KEY", "oc_xxx");
        environment.put("JWT_SECRET", "jwt");
        environment.put("POSTGRES_PASSWORD", "pw");
        environment.put("DATABASE_URL", "postgres://user:pw@db/app");
        environment.put("AWS_ACCESS_KEY_ID", "AKIA");
        environment.put("NORMAL", "removed-by-allowlist");

        OpenCodeClient.sanitizeEnvironment(environment);

        assertEquals("/usr/bin", environment.get("PATH"));
        assertEquals("/home/agent", environment.get("HOME"));
        assertFalse(environment.containsKey("NORMAL"));
        assertFalse(environment.containsKey("GITHUB_TOKEN"));
        assertFalse(environment.containsKey("AI_API_KEY"));
        assertFalse(environment.containsKey("OPENCODE_API_KEY"));
        assertFalse(environment.containsKey("JWT_SECRET"));
        assertFalse(environment.containsKey("POSTGRES_PASSWORD"));
        assertFalse(environment.containsKey("DATABASE_URL"));
        assertFalse(environment.containsKey("AWS_ACCESS_KEY_ID"));
    }

    @Test
    void childEnvironmentDisablesProjectConfigAndDropsSecrets() {
        java.util.Map<String, String> environment = new java.util.HashMap<>();
        environment.put("PATH", "/usr/bin");
        environment.put("GITHUB_TOKEN", "ghp_xxx");
        environment.put("DATABASE_URL", "postgres://user:pw@db/app");

        OpenCodeClient.configureChildEnvironment(
            environment, tempDir, tempDir.resolve("opencode.json"), "server-password");

        assertEquals("true", environment.get("OPENCODE_DISABLE_PROJECT_CONFIG"));
        assertEquals(tempDir.toString(), environment.get("HOME"));
        assertEquals("server-password", environment.get("OPENCODE_SERVER_PASSWORD"));
        assertFalse(environment.containsKey("GITHUB_TOKEN"));
        assertFalse(environment.containsKey("DATABASE_URL"));
    }

    @Test
    void writesTheSandboxBashToolIntoThePerRunHome() throws Exception {
        Path home = tempDir.resolve("tool-home");

        Path tool = OpenCodeClient.writeSandboxTool(home);

        assertEquals(home.resolve(".config/opencode/tools/sandbox_bash.ts"), tool);
        String source = Files.readString(tool);
        assertTrue(source.contains("VIBECODE_SANDBOX_BRIDGE_URL"));
        assertTrue(source.contains("VIBECODE_SANDBOX_BRIDGE_TOKEN"));
        assertTrue(source.contains("tool.schema.string()"));
        assertTrue(source.contains("x-sandbox-token"));
        assertTrue(source.contains("requestId"));
        assertTrue(source.contains("sandbox command rejected"));
    }

    @Test
    void writesTheWorkspaceGuardToolsIntoThePerRunHome() throws Exception {
        Path home = tempDir.resolve("workspace-tool-home");

        Path tools = OpenCodeClient.writeWorkspaceTools(home);

        assertEquals(home.resolve(".config/opencode/tools"), tools);
        String read = Files.readString(tools.resolve("sandbox_read.ts"));
        String grep = Files.readString(tools.resolve("sandbox_grep.ts"));
        String write = Files.readString(tools.resolve("sandbox_write.ts"));
        String edit = Files.readString(tools.resolve("sandbox_edit.ts"));
        assertTrue(read.contains("VIBECODE_WORKSPACE_BRIDGE_URL"));
        assertTrue(read.contains("VIBECODE_WORKSPACE_BRIDGE_TOKEN"));
        assertTrue(read.contains("/read"));
        assertTrue(read.contains("x-workspace-token"));
        assertTrue(read.contains("read rejected"));
        assertTrue(grep.contains("/grep"));
        assertTrue(grep.contains("x-workspace-token"));
        assertTrue(grep.contains("grep rejected"));
        assertTrue(write.contains("/write"));
        assertTrue(write.contains("write rejected"));
        assertTrue(edit.contains("/edit"));
        assertTrue(edit.contains("edit rejected"));
    }

    @Test
    void generatedWorkspaceToolsAreSyntacticallyValid() throws Exception {
        Path home = tempDir.resolve("workspace-syntax-home");
        Path tools = OpenCodeClient.writeWorkspaceTools(home);

        for (String name : List.of(
            "sandbox_read.ts", "sandbox_grep.ts", "sandbox_write.ts", "sandbox_edit.ts")) {
            Process process;
            try {
                process = new ProcessBuilder("node", "--check",
                    tools.resolve(name).toString())
                    .redirectErrorStream(true)
                    .start();
            } catch (IOException e) {
                org.junit.jupiter.api.Assumptions.assumeTrue(false,
                    "node is required to validate the generated tool");
                return;
            }
            String output = new String(process.getInputStream().readAllBytes());
            assertEquals(0, process.waitFor(), name + ": " + output);
        }
    }

    @Test
    void secureFileAccessCanBeRequiredExplicitlyInHostMode() {
        assertTrue(OpenCodeClient.requireSecureFileAccess(true, null));
        assertFalse(OpenCodeClient.requireSecureFileAccess(false, null));
        assertFalse(OpenCodeClient.requireSecureFileAccess(false, "false"));
        assertFalse(OpenCodeClient.requireSecureFileAccess(false, "0"));
        assertTrue(OpenCodeClient.requireSecureFileAccess(false, "true"));
        assertTrue(OpenCodeClient.requireSecureFileAccess(false, "1"));
        assertThrows(IllegalStateException.class,
            () -> OpenCodeClient.requireSecureFileAccess(false, "yes"));
    }

    @Test
    void injectsTheWorkspaceBridgeUrlAndToken() throws Exception {
        Path home = tempDir.resolve("workspace-env-home");
        Path workspace = Files.createDirectories(tempDir.resolve("workspace-env"));
        WorkspaceFileBridge workspaceBridge = new WorkspaceFileBridge(workspace);
        workspaceBridge.start();
        try {
            Map<String, String> environment = new HashMap<>();
            OpenCodeClient.configureChildEnvironment(
                environment, home, home.resolve("opencode.json"), "password",
                null, workspaceBridge);

            assertEquals(workspaceBridge.baseUrl(),
                environment.get("VIBECODE_WORKSPACE_BRIDGE_URL"));
            assertEquals(workspaceBridge.token(),
                environment.get("VIBECODE_WORKSPACE_BRIDGE_TOKEN"));

            Map<String, String> stale = new HashMap<>();
            stale.put("VIBECODE_WORKSPACE_BRIDGE_URL", "http://stale");
            stale.put("VIBECODE_WORKSPACE_BRIDGE_TOKEN", "stale");
            OpenCodeClient.configureChildEnvironment(
                stale, home, home.resolve("opencode.json"), "password");
            assertFalse(stale.containsKey("VIBECODE_WORKSPACE_BRIDGE_URL"));
            assertFalse(stale.containsKey("VIBECODE_WORKSPACE_BRIDGE_TOKEN"));
        } finally {
            workspaceBridge.close();
        }
    }

    @Test
    void generatedSandboxToolRetriesWithTheSameRequestIdAfterALostResponse() throws Exception {
        Assumptions.assumeTrue(nodeAvailable(), "node is required");
        Path dir = Files.createDirectories(tempDir.resolve("retry-tool"));
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
            process.env.VIBECODE_SANDBOX_BRIDGE_URL = "http://127.0.0.1:9";
            process.env.VIBECODE_SANDBOX_BRIDGE_TOKEN = "test-token";
            const { default: tool } = await import("./tool.mjs");
            let calls = 0;
            const ids = [];
            globalThis.fetch = async (url, options) => {
              calls++;
              ids.push(JSON.parse(options.body).requestId);
              if (calls === 1) {
                throw new Error("response lost");
              }
              return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode(
                      JSON.stringify({
                        type: "result",
                        exitCode: 0,
                        output: "ok",
                        timedOut: false,
                        truncated: false,
                      }) + "\\n"));
                    controller.close();
                  },
                }),
              };
            };
            const result = await tool.execute(
              { command: "echo hi", timeoutSeconds: 5 },
              { directory: "/workspace" });
            console.log(JSON.stringify({ calls, ids, result }));
            """);

        Process process = new ProcessBuilder("node", harness.toString())
            .redirectErrorStream(true)
            .start();
        String output = new String(process.getInputStream().readAllBytes(),
            java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(0, process.waitFor(), output);
        JsonNode json = new ObjectMapper().readTree(output.trim());
        assertEquals(2, json.path("calls").asInt(), output);
        assertEquals(2, json.path("ids").size(), output);
        assertEquals(json.path("ids").get(0).asText(), json.path("ids").get(1).asText(),
            output);
        assertEquals("ok", json.path("result").asText(), output);
    }

    @Test
    void generatedSandboxToolDoesNotRetryTimedOutResults() throws Exception {
        JsonNode json = runToolFetchStub("timeout");
        assertEquals(1, json.path("calls").asInt(), json.toString());
        assertTrue(json.path("error").asText().contains("timed out"), json.toString());
    }

    @Test
    void generatedSandboxToolDoesNotRetryNonRetryableStatuses() throws Exception {
        JsonNode json = runToolFetchStub("403");
        assertEquals(1, json.path("calls").asInt(), json.toString());
        assertTrue(json.path("error").asText().contains("rejected"), json.toString());
    }

    @Test
    void generatedSandboxToolStopsAfterAllAttemptsFail() throws Exception {
        JsonNode json = runToolFetchStub("network");
        assertEquals(3, json.path("calls").asInt(), json.toString());
        assertTrue(json.path("error").asText().contains("network down"), json.toString());
    }

    private JsonNode runToolFetchStub(String mode) throws Exception {
        Assumptions.assumeTrue(nodeAvailable(), "node is required");
        Path dir = Files.createDirectories(tempDir.resolve("stub-" + mode));
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
            process.env.VIBECODE_SANDBOX_BRIDGE_URL = "http://127.0.0.1:9";
            process.env.VIBECODE_SANDBOX_BRIDGE_TOKEN = "test-token";
            const { default: tool } = await import("./tool.mjs");
            let calls = 0;
            globalThis.fetch = async () => {
              calls++;
              const mode = process.env.STUB_MODE;
              if (mode === "timeout") {
                return {
                  ok: true,
                  status: 200,
                  body: new ReadableStream({
                    start(controller) {
                      controller.enqueue(new TextEncoder().encode(
                        JSON.stringify({
                          type: "result",
                          exitCode: 0,
                          output: "slow",
                          timedOut: true,
                          truncated: false,
                        }) + "\\n"));
                      controller.close();
                    },
                  }),
                };
              }
              if (mode === "403") {
                return { ok: false, status: 403, text: async () => "denied" };
              }
              throw new Error("network down");
            };
            let error = null;
            try {
              await tool.execute(
                { command: "echo hi", timeoutSeconds: 5 },
                { directory: "/workspace" });
            } catch (caught) {
              error = caught.message;
            }
            console.log(JSON.stringify({ calls, error }));
            """);

        ProcessBuilder builder = new ProcessBuilder("node", harness.toString())
            .redirectErrorStream(true);
        builder.environment().put("STUB_MODE", mode);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(),
            java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(0, process.waitFor(), output);
        return new ObjectMapper().readTree(output.trim());
    }

    @Test
    void generatedSandboxToolIsSyntacticallyValid() throws Exception {
        Path home = tempDir.resolve("syntax-home");
        Path tool = OpenCodeClient.writeSandboxTool(home);

        Process process;
        try {
            process = new ProcessBuilder("node", "--check", tool.toString())
                .redirectErrorStream(true)
                .start();
        } catch (IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "node is required to validate the generated tool");
            return;
        }
        String output = new String(process.getInputStream().readAllBytes());
        assertEquals(0, process.waitFor(), output);
    }

    @Test
    void injectsTheBridgeUrlAndTokenOnlyWhenASandboxIsActive() throws Exception {
        Path home = tempDir.resolve("env-home");
        Path workspace = Files.createDirectories(tempDir.resolve("env-workspace"));
        SandboxBashBridge bridge = new SandboxBashBridge(
            SandboxRunnerFactory.hostOnly(),
            new SandboxHandle("sandbox-1", workspace, false, null),
            workspace,
            Duration.ofSeconds(30));
        bridge.start();
        try {
            Map<String, String> environment = new HashMap<>();
            OpenCodeClient.configureChildEnvironment(
                environment, home, home.resolve("opencode.json"), "password", bridge);

            assertEquals(bridge.baseUrl(), environment.get("VIBECODE_SANDBOX_BRIDGE_URL"));
            assertEquals(bridge.token(), environment.get("VIBECODE_SANDBOX_BRIDGE_TOKEN"));

            Map<String, String> hostEnvironment = new HashMap<>();
            hostEnvironment.put("VIBECODE_SANDBOX_BRIDGE_URL", "http://stale");
            hostEnvironment.put("VIBECODE_SANDBOX_BRIDGE_TOKEN", "stale");
            OpenCodeClient.configureChildEnvironment(
                hostEnvironment, home, home.resolve("opencode.json"), "password");
            assertFalse(hostEnvironment.containsKey("VIBECODE_SANDBOX_BRIDGE_URL"));
            assertFalse(hostEnvironment.containsKey("VIBECODE_SANDBOX_BRIDGE_TOKEN"));
        } finally {
            bridge.close();
        }
    }

    @Test
    void failsFastWhenHarnessProcessExitsEarly() {
        String javaBinary = Path.of(
            System.getProperty("java.home"), "bin",
            System.getProperty("os.name", "").toLowerCase().contains("win") ? "java.exe" : "java"
        ).toString();
        HarnessConfig processConfig = new HarnessConfig(
            
            javaBinary, Duration.ofSeconds(10),
            Duration.ofMinutes(5), List.of(), List.of(".env*"), null, "restart");
        ProviderSettings provider = new ProviderSettings(
            "opencode-go", "key", null, "beam-free", 4096);
        OpenCodeClient client = new OpenCodeClient(processConfig, provider, tempDir.resolve("proc"));

        IOException error = assertThrows(IOException.class, () -> client.start(tempDir));

        assertTrue(error.getMessage().contains("exited")
            || error.getMessage().contains("healthy"));
        client.close();
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
