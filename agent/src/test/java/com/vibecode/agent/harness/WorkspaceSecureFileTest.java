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

        // Simulate a parent component swapping to a symlink before the open.
        assertThrows(IOException.class, () -> WorkspaceSecureFile.writeString(
            workspace, workspace.resolve("sub/file.txt"), "pwned", true));
        assertEquals("safe", Files.readString(outside));
    }

    @Test
    void refusesAFinalComponentSymlinkForReadAndWrite() throws Exception {
        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "super-secret");
        Path link = workspace.resolve("final-link.txt");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (UnsupportedOperationException | IOException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false,
                "symlinks are unavailable: " + e.getMessage());
        }

        assertThrows(IOException.class,
            () -> WorkspaceSecureFile.readString(workspace, link, 1024));
        assertThrows(IOException.class,
            () -> WorkspaceSecureFile.writeString(workspace, link, "pwned", true));
        assertEquals("super-secret", Files.readString(outside));
    }

    @Test
    void rejectsAFinalComponentSwapAtOpenTime() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(
            WorkspaceSecureFile.secureDirectoryStreamsAvailable(workspace),
            "secure directory streams are unavailable");
        Path file = Files.writeString(workspace.resolve("file.txt"), "safe");
        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "super-secret");
        WorkspaceSecureFile.setBeforeFinalOpenForTesting(() -> {
            Files.deleteIfExists(file);
            Files.createSymbolicLink(file, outside);
        });
        try {
            assertThrows(IOException.class,
                () -> WorkspaceSecureFile.writeString(workspace, file, "pwned", true));
            assertEquals("super-secret", Files.readString(outside));

            Files.delete(file);
            Files.writeString(file, "safe");
            assertThrows(IOException.class,
                () -> WorkspaceSecureFile.readString(workspace, file, 1024));
        } finally {
            WorkspaceSecureFile.setBeforeFinalOpenForTesting(null);
        }
    }

    @Test
    void fallbackPathStillWorksWhenSecureDirectoryStreamsAreUnavailable() throws Exception {
        Path file = Files.writeString(workspace.resolve("fallback.txt"), "one");
        WorkspaceSecureFile.forceFallbackForTesting(true);
        try {
            WorkspaceSecureFile.writeString(workspace, file, "two", true);
            assertEquals("two", WorkspaceSecureFile.readString(workspace, file, 1024));
        } finally {
            WorkspaceSecureFile.forceFallbackForTesting(false);
        }
    }

    @Test
    void rejectsInteriorParentTraversal() throws Exception {
        Files.createDirectories(workspace.resolve("sub"));
        Files.writeString(workspace.resolve("file.txt"), "inside");

        assertThrows(IOException.class, () -> WorkspaceSecureFile.readString(
            workspace, workspace.resolve("sub/../file.txt"), 1024));
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
