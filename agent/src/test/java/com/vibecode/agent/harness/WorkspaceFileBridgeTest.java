package com.vibecode.agent.harness;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkspaceFileBridgeTest {

    @TempDir
    Path tempDir;

    private Path workspace;
    private WorkspaceFileBridge bridge;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach
    void setUp() throws IOException {
        workspace = Files.createDirectories(tempDir.resolve("workspace")).toRealPath();
        bridge = new WorkspaceFileBridge(workspace);
        bridge.start();
    }

    @AfterEach
    void tearDown() {
        if (bridge != null) {
            bridge.close();
        }
    }

    @Test
    void readsAFileWithLineNumbers() throws Exception {
        Files.writeString(workspace.resolve("App.java"), "class App {\n  int x;\n}\n");

        HttpResponse<String> response = post("/read", "{\"path\":\"App.java\"}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("1: class App {"), response.body());
        assertTrue(response.body().contains("3: }"), response.body());
    }

    @Test
    void readRespectsOffsetAndLimit() throws Exception {
        Files.writeString(workspace.resolve("lines.txt"), "one\ntwo\nthree\nfour\n");

        HttpResponse<String> response = post(
            "/read", "{\"path\":\"lines.txt\",\"offset\":2,\"limit\":2}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("2: two"), response.body());
        assertTrue(response.body().contains("3: three"), response.body());
        assertFalse(response.body().contains("1: one"), response.body());
        assertFalse(response.body().contains("4: four"), response.body());
    }

    @Test
    void rejectsSymlinkEscapeWithoutLeaking() throws Exception {
        Path outside = Files.writeString(tempDir.resolve("secret.txt"), "super-secret");
        try {
            Files.createSymbolicLink(workspace.resolve("leak.txt"), outside);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        HttpResponse<String> response = post("/read", "{\"path\":\"leak.txt\"}", true);

        assertEquals(403, response.statusCode());
        assertFalse(response.body().contains("super-secret"), response.body());
        assertTrue(response.body().contains("escapes the workspace"), response.body());
    }

    @Test
    void rejectsTraversalAndCredentialPaths() throws Exception {
        Files.writeString(tempDir.resolve("outside.txt"), "secret");
        Files.writeString(workspace.resolve(".env"), "TOKEN=secret");
        Files.createDirectories(workspace.resolve("secrets"));
        Files.writeString(workspace.resolve("secrets/token.txt"), "secret");

        assertEquals(403, post("/read", "{\"path\":\"../outside.txt\"}", true).statusCode());
        assertEquals(403, post("/read", "{\"path\":\".env\"}", true).statusCode());
        assertEquals(403, post("/read", "{\"path\":\"secrets/token.txt\"}", true).statusCode());
    }

    @Test
    void allowsEnvExampleFiles() throws Exception {
        Files.writeString(workspace.resolve(".env.example"), "TOKEN=example");

        HttpResponse<String> response = post("/read", "{\"path\":\".env.example\"}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("TOKEN=example"), response.body());
    }

    @Test
    void requiresTheBridgeToken() throws Exception {
        Files.writeString(workspace.resolve("App.java"), "class App {}");

        assertEquals(401, post("/read", "{\"path\":\"App.java\"}", false).statusCode());
    }

    @Test
    void grepsTextAndSkipsSymlinksAndBuildDirectories() throws Exception {
        Files.createDirectories(workspace.resolve("src"));
        Files.writeString(workspace.resolve("src/App.java"), "needle here\n");
        Files.writeString(workspace.resolve("README.md"), "needle docs\n");
        Files.createDirectories(workspace.resolve("node_modules/pkg"));
        Files.writeString(workspace.resolve("node_modules/pkg/index.js"), "needle ignored\n");

        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "needle outside\n");
        try {
            Files.createSymbolicLink(workspace.resolve("leak.txt"), outside);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        HttpResponse<String> response = post("/grep", "{\"pattern\":\"needle\"}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("src/App.java:1: needle here"), response.body());
        assertTrue(response.body().contains("README.md:1: needle docs"), response.body());
        assertFalse(response.body().contains("node_modules"), response.body());
        assertFalse(response.body().contains("leak.txt"), response.body());
        assertFalse(response.body().contains("outside"), response.body());
    }

    @Test
    void grepHonorsIncludeGlob() throws Exception {
        Files.writeString(workspace.resolve("App.java"), "needle\n");
        Files.writeString(workspace.resolve("App.txt"), "needle\n");

        HttpResponse<String> response = post(
            "/grep", "{\"pattern\":\"needle\",\"include\":\"*.java\"}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("App.java"), response.body());
        assertFalse(response.body().contains("App.txt"), response.body());
    }

    @Test
    void grepCapsMatches() throws Exception {
        Files.writeString(workspace.resolve("matches.txt"), "needle 1\nneedle 2\nneedle 3\n");

        HttpResponse<String> response = post(
            "/grep", "{\"pattern\":\"needle\",\"maxResults\":2}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("truncated at 2 matches"), response.body());
        assertFalse(response.body().contains("needle 3"), response.body());
    }

    @Test
    void grepTruncatesLongMatchingLines() throws Exception {
        Files.writeString(workspace.resolve("long.txt"),
            "needle " + "x".repeat(1_000) + "\n");

        HttpResponse<String> response = post("/grep", "{\"pattern\":\"needle\"}", true);

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("needle xxx"), response.body());
        assertTrue(response.body().contains("..."), response.body());
        assertFalse(response.body().contains("x".repeat(600)), response.body());
    }

    @Test
    void rejectsAnInvalidRegularExpression() throws Exception {
        HttpResponse<String> response = post("/grep", "{\"pattern\":\"[\"}", true);

        assertEquals(400, response.statusCode());
        assertTrue(response.body().contains("invalid regular expression"), response.body());
    }

    private HttpResponse<String> post(String endpoint, String body, boolean token)
        throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(
                URI.create(bridge.baseUrl() + endpoint))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body));
        if (token) {
            request.header("X-Workspace-Token", bridge.token());
        }
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
