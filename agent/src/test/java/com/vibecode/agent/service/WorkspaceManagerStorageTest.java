package com.vibecode.agent.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-44: runtime/ticket workspace layout, cleanup and measurement. */
class WorkspaceManagerStorageTest {

    @TempDir
    Path tempDir;

    @Test
    void usesARuntimeTicketLayoutAndCreatesSubdirectories() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", true, null, null, "34");

        manager.cloneRepo("https://github.com/acme/repo.git", "feat/x");

        assertEquals(runtimeRoot.resolve("34"), manager.getWorkspaceRoot());
        assertEquals(runtimeRoot.resolve("34/repo"), manager.getRepoDir());
        assertEquals(runtimeRoot.resolve("cache"), manager.getCacheDir());
    }

    @Test
    void keyedCleanupRemovesOnlyTheTicketRootAndMarker() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getWorkspaceRoot().resolve("repo"));
        manager.writeActiveMarker("run-1");
        Files.writeString(manager.getWorkspaceRoot().resolve("repo/file.txt"), "x");

        manager.cleanup("34");

        assertFalse(Files.exists(manager.getWorkspaceRoot()));
        assertTrue(Files.exists(runtimeRoot), "runtime root survives ticket cleanup");
    }

    @Test
    void cleanupRuntimeRemovesTheCacheAndRuntimeRoot() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getCacheDir());
        Files.createDirectories(manager.getWorkspaceRoot());

        manager.cleanupRuntime();

        assertFalse(Files.exists(runtimeRoot));
    }

    @Test
    void measuresBytesAndInodes() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getWorkspaceRoot().resolve("repo"));
        Files.writeString(manager.getWorkspaceRoot().resolve("a.txt"), "12345");
        Files.writeString(manager.getWorkspaceRoot().resolve("b.txt"), "123");

        assertEquals(8, manager.workspaceBytes());
        assertTrue(manager.workspaceInodes() >= 4);
    }

    @Test
    void refusalToDeleteTheRepositoryBaseRoot() throws Exception {
        Path base = tempDir.resolve("repos");
        Files.createDirectories(base);
        WorkspaceManager manager = new WorkspaceManager(
            base.toString(), "repo", false, null, null, "34");

        assertThrows(java.io.IOException.class, manager::cleanupRuntime);
        assertTrue(Files.exists(base));
    }

    @Test
    void quarantineMovesTheTicketRootUnderSiblingOrphans() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getWorkspaceRoot().resolve("repo"));
        Files.writeString(manager.getWorkspaceRoot().resolve("repo/file.txt"), "x");

        Path moved = manager.quarantine();

        assertFalse(Files.exists(manager.getWorkspaceRoot()));
        assertTrue(Files.exists(moved));
        assertTrue(moved.startsWith(tempDir.resolve("orphans")));
        assertEquals("x", Files.readString(moved.resolve("repo/file.txt")));
    }

    @Test
    void measuresLogBytes() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Path logs = manager.getWorkspaceRoot().resolve("logs");
        Files.createDirectories(logs);
        Files.writeString(logs.resolve("run.log"), "1234567");

        assertEquals(7, manager.logsBytes());
    }

    @Test
    void refusesTraversalKeys() {
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", true, null, null, "34");

        assertThrows(IllegalArgumentException.class,
            () -> manager.cleanup("../escape"));
        assertThrows(IllegalArgumentException.class,
            () -> manager.setWorkspaceKey(".."));
    }
}
