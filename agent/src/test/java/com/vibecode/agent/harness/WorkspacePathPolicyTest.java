package com.vibecode.agent.harness;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkspacePathPolicyTest {

    @TempDir
    Path tempDir;

    private Path workspace;

    @BeforeEach
    void setUp() throws IOException {
        workspace = Files.createDirectories(tempDir.resolve("workspace")).toRealPath();
    }

    @Test
    void resolvesAFileInsideTheWorkspace() throws IOException {
        Path file = Files.writeString(workspace.resolve("App.java"), "class App {}");

        assertEquals(file.toRealPath(),
            WorkspacePathPolicy.resolveReadable(workspace, "App.java"));
    }

    @Test
    void rejectsParentTraversalAndAbsolutePathsOutside() throws IOException {
        Files.writeString(tempDir.resolve("outside.txt"), "secret");

        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveReadable(workspace, "../outside.txt"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveReadable(
                workspace, tempDir.resolve("outside.txt").toString()));
    }

    @Test
    void rejectsASymlinkThatEscapesTheWorkspace() throws Exception {
        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "super-secret");
        Path link = workspace.resolve("leak.txt");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        IOException error = assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveReadable(workspace, "leak.txt"));
        assertTrue(error.getMessage().contains("escapes the workspace"), error.getMessage());
    }

    @Test
    void allowsASymlinkThatStaysInsideTheWorkspace() throws Exception {
        Path target = Files.writeString(workspace.resolve("target.txt"), "inside");
        Path link = workspace.resolve("inside-link.txt");
        try {
            Files.createSymbolicLink(link, target);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        assertEquals(target.toRealPath(),
            WorkspacePathPolicy.resolveReadable(workspace, "inside-link.txt"));
    }

    @Test
    void resolvesWritableTargetsInsideTheWorkspace() throws IOException {
        Path existing = Files.writeString(workspace.resolve("App.java"), "class App {}");
        assertEquals(existing.toRealPath(),
            WorkspacePathPolicy.resolveWritable(workspace, "App.java"));

        Path created = WorkspacePathPolicy.resolveWritable(workspace, "New.java");
        assertEquals(workspace.resolve("New.java"), created);
    }

    @Test
    void rejectsWriteSymlinksTraversalAndDeniedPaths() throws Exception {
        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "super-secret");
        Path link = workspace.resolve("write-link.txt");
        Path outsideDir = Files.createDirectories(tempDir.resolve("outside-dir"));
        Path dirLink = workspace.resolve("outside-dir-link");
        Path brokenLink = workspace.resolve("broken-link.txt");
        try {
            Files.createSymbolicLink(link, outside);
            Files.createSymbolicLink(dirLink, outsideDir);
            Files.createSymbolicLink(brokenLink, tempDir.resolve("does-not-exist.txt"));
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "write-link.txt"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "broken-link.txt"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "outside-dir-link/new.txt"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "../outside.txt"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, ".git/hooks/pre-commit"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "opencode.json"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, ".env"));
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "secrets/token.txt"));
    }

    @Test
    void rejectsAWriteWithAMissingParentDirectory() {
        assertThrows(IOException.class,
            () -> WorkspacePathPolicy.resolveWritable(workspace, "missing/new.txt"));
    }

    @Test
    void deniesCredentialPathsAfterResolution() throws IOException {
        Files.createDirectories(workspace.resolve("secrets"));
        Files.createDirectories(workspace.resolve(".ssh"));
        Files.createDirectories(workspace.resolve(".aws"));
        Files.createDirectories(workspace.resolve(".git"));

        for (String path : java.util.List.of(
            ".env", ".env.local", "app.env", "app.env.local",
            "secrets/token.txt", ".ssh/id_rsa", ".aws/credentials",
            ".git/config", ".npmrc", ".netrc")) {
            Path file = workspace.resolve(path);
            Files.createDirectories(file.getParent());
            Files.writeString(file, "super-secret");
            assertThrows(IOException.class,
                () -> WorkspacePathPolicy.resolveReadable(workspace, path), path);
        }
    }

    @Test
    void allowsEnvExampleFiles() throws IOException {
        Files.writeString(workspace.resolve(".env.example"), "TOKEN=example");
        Files.writeString(workspace.resolve("app.env.example"), "TOKEN=example");

        assertEquals(workspace.resolve(".env.example").toRealPath(),
            WorkspacePathPolicy.resolveReadable(workspace, ".env.example"));
        assertEquals(workspace.resolve("app.env.example").toRealPath(),
            WorkspacePathPolicy.resolveReadable(workspace, "app.env.example"));
    }

    @Test
    void ignoresBuildAndVcsDirectories() {
        assertTrue(WorkspacePathPolicy.isIgnoredDirectory(".git"));
        assertTrue(WorkspacePathPolicy.isIgnoredDirectory("node_modules"));
        assertTrue(WorkspacePathPolicy.isIgnoredDirectory("target"));
        assertTrue(WorkspacePathPolicy.isIgnoredDirectory("build"));
        assertTrue(WorkspacePathPolicy.isIgnoredDirectory("dist"));
        assertFalse(WorkspacePathPolicy.isIgnoredDirectory("src"));
    }
}
