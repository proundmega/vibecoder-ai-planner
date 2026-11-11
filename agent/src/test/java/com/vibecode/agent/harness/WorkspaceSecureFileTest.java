package com.vibecode.agent.harness;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkspaceSecureFileTest {

    @TempDir
    Path tempDir;

    private Path workspace;

    @BeforeEach
    void setUp() throws IOException {
        workspace = Files.createDirectories(tempDir.resolve("workspace")).toRealPath();
    }

    @Test
    void refusesAWriteWhoseParentWasSwappedForASymlink() throws Exception {
        Path outsideDir = Files.createDirectories(tempDir.resolve("outside"));
        Path outside = Files.writeString(outsideDir.resolve("file.txt"), "safe");
        Path sub = Files.createDirectories(workspace.resolve("sub"));
        Files.delete(sub);

        try {
            Files.createSymbolicLink(sub, outsideDir);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        // Simulate the check-then-open race by calling the secure writer with a
        // path whose parent is now a symlink.
        assertThrows(IOException.class, () -> WorkspaceSecureFile.writeString(
            workspace, workspace.resolve("sub/file.txt"), "pwned", true));
        assertEquals("safe", Files.readString(outside));
    }

    @Test
    void refusesAReadWhoseParentWasSwappedForASymlink() throws Exception {
        Path outsideDir = Files.createDirectories(tempDir.resolve("outside"));
        Files.writeString(outsideDir.resolve("file.txt"), "super-secret");
        Path sub = Files.createDirectories(workspace.resolve("sub"));
        Files.delete(sub);

        try {
            Files.createSymbolicLink(sub, outsideDir);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        assertThrows(IOException.class, () -> WorkspaceSecureFile.readString(
            workspace, workspace.resolve("sub/file.txt"), 1024));
    }
}
