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

    @Test
    void writesAndEditsFilesInsideTheWorkspace() throws Exception {
        HttpResponse<String> write = post(
            "/write", "{\"path\":\"App.java\",\"content\":\"class App {}\"}", true);
        assertEquals(200, write.statusCode());
        assertEquals("class App {}", Files.readString(workspace.resolve("App.java")));

        HttpResponse<String> edit = post(
            "/edit",
            "{\"path\":\"App.java\",\"oldString\":\"App\",\"newString\":\"Main\"}",
            true);
        assertEquals(200, edit.statusCode());
        assertEquals("class Main {}", Files.readString(workspace.resolve("App.java")));
    }

    @Test
    void rejectsWriteSymlinkEscapesAndDeniedPaths() throws Exception {
        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "super-secret");
        Path link = workspace.resolve("write-link.txt");
        Files.createDirectories(workspace.resolve(".git/hooks"));
        Files.createDirectories(workspace.resolve("secrets"));
        try {
            Files.createSymbolicLink(link, outside);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        assertEquals(403, post(
            "/write", "{\"path\":\"write-link.txt\",\"content\":\"pwned\"}", true).statusCode());
        assertEquals("super-secret", Files.readString(outside));
        HttpResponse<String> env = post(
            "/write", "{\"path\":\".env\",\"content\":\"TOKEN=x\"}", true);
        assertEquals(403, env.statusCode());
        assertTrue(env.body().contains("denied by the write policy"), env.body());
        HttpResponse<String> git = post(
            "/write", "{\"path\":\".git/hooks/pre-commit\",\"content\":\"x\"}", true);
        assertEquals(403, git.statusCode());
        assertTrue(git.body().contains("denied by the write policy"), git.body());
        assertEquals(403, post(
            "/write", "{\"path\":\"secrets/token.txt\",\"content\":\"x\"}", true).statusCode());
        assertEquals(403, post(
            "/write", "{\"path\":\"../outside.txt\",\"content\":\"x\"}", true).statusCode());
    }

    @Test
    void rejectsAnEditWhoseResultExceedsTheWriteCap() throws Exception {
        Files.writeString(workspace.resolve("large.txt"), "a".repeat(1100 * 1024));

        HttpResponse<String> response = post(
            "/edit",
            "{\"path\":\"large.txt\",\"oldString\":\"a\",\"newString\":\"b\",\"replaceAll\":true}",
            true);

        assertEquals(413, response.statusCode());
        assertTrue(response.body().contains("exceeds"), response.body());
    }

    @Test
    void editPreservesBomAndCrlfLineEndings() throws Exception {
        Files.writeString(workspace.resolve("win.txt"), "\uFEFFone\r\ntwo\r\n");

        HttpResponse<String> response = post(
            "/edit",
            "{\"path\":\"win.txt\",\"oldString\":\"one\\ntwo\",\"newString\":\"one\\nchanged\"}",
            true);

        assertEquals(200, response.statusCode());
        assertEquals("\uFEFFone\r\nchanged\r\n",
            Files.readString(workspace.resolve("win.txt")));
    }

    @Test
    void rejectsAnExistingFifoInsteadOfBlocking() throws Exception {
        Path fifo = workspace.resolve("pipe");
        Process mkfifo;
        try {
            mkfifo = new ProcessBuilder("mkfifo", fifo.toString())
                .redirectErrorStream(true)
                .start();
        } catch (IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "mkfifo is unavailable: " + e.getMessage());
            return;
        }
        assertEquals(0, mkfifo.waitFor());

        HttpResponse<String> response = post(
            "/write", "{\"path\":\"pipe\",\"content\":\"x\"}", true);

        assertEquals(403, response.statusCode());
        assertTrue(response.body().contains("regular file"), response.body());
    }

    @Test
    void rejectsAnOversizedReplaceAllBeforeAllocating() throws Exception {
        Files.writeString(workspace.resolve("big.txt"), "a".repeat(1024 * 1024));
        String replacement = "b".repeat(1024);

        HttpResponse<String> response = post(
            "/edit",
            "{\"path\":\"big.txt\",\"oldString\":\"a\",\"newString\":\""
                + replacement + "\",\"replaceAll\":true}",
            true);

        assertEquals(413, response.statusCode());
        assertTrue(response.body().contains("exceeds"), response.body());
    }

    @Test
    void editRequiresAUniqueMatchAndRejectsSymlinks() throws Exception {
        Files.writeString(workspace.resolve("App.java"), "needle needle\n");
        assertEquals(400, post(
            "/edit",
            "{\"path\":\"App.java\",\"oldString\":\"needle\",\"newString\":\"x\"}",
            true).statusCode());

        HttpResponse<String> all = post(
            "/edit",
            "{\"path\":\"App.java\",\"oldString\":\"needle\",\"newString\":\"x\",\"replaceAll\":true}",
            true);
        assertEquals(200, all.statusCode());
        assertEquals("x x\n", Files.readString(workspace.resolve("App.java")));

        assertEquals(400, post(
            "/edit",
            "{\"path\":\"App.java\",\"oldString\":\"missing\",\"newString\":\"x\"}",
            true).statusCode());

        Path outside = Files.writeString(tempDir.resolve("edit-outside.txt"), "secret");
        Path link = workspace.resolve("edit-link.txt");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }
        assertEquals(403, post(
            "/edit",
            "{\"path\":\"edit-link.txt\",\"oldString\":\"secret\",\"newString\":\"x\"}",
            true).statusCode());
        assertEquals("secret", Files.readString(outside));
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
