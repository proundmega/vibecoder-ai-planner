package com.vibecode.agent.harness;

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
            "opencode",
            startupTimeout,
            Duration.ofSeconds(30),
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
        assertTrue(source.contains("sandbox command rejected"));
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
            "opencode", javaBinary, Duration.ofSeconds(10), Duration.ofSeconds(5),
            Duration.ofMinutes(5), List.of(), List.of(".env*"), null, "restart");
        ProviderSettings provider = new ProviderSettings(
            "opencode-go", "key", null, "beam-free", 4096);
        OpenCodeClient client = new OpenCodeClient(processConfig, provider, tempDir.resolve("proc"));

        IOException error = assertThrows(IOException.class, () -> client.start(tempDir));

        assertTrue(error.getMessage().contains("exited")
            || error.getMessage().contains("healthy"));
        client.close();
    }
}
