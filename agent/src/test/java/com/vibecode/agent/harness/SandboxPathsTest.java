package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SandboxPathsTest {

    @TempDir
    Path tempDir;

    @TempDir
    Path outsideDir;

    @Test
    void normalizesRelativeContainerPaths() throws IOException {
        assertEquals("/workspace", SandboxPaths.containerPath(null));
        assertEquals("/workspace", SandboxPaths.containerPath("."));
        assertEquals("/workspace/backend", SandboxPaths.containerPath("backend"));
        assertEquals("/workspace/backend", SandboxPaths.containerPath("/workspace/backend"));
        assertEquals("/workspace/backend", SandboxPaths.containerPath("/workspace/a/../backend"));
    }

    @Test
    void rejectsContainerPathEscapes() {
        assertThrows(IOException.class, () -> SandboxPaths.containerPath("/etc/passwd"));
        assertThrows(IOException.class, () -> SandboxPaths.containerPath("/workspace/../../etc"));
        assertThrows(IOException.class, () -> SandboxPaths.containerPath("../../etc"));
    }

    @Test
    void resolvesCwdInsideTheWorkspace() throws IOException {
        Path backend = Files.createDirectories(tempDir.resolve("backend"));

        assertEquals(tempDir.toRealPath(), SandboxPaths.resolveCwd(tempDir, null));
        assertEquals(tempDir.toRealPath(), SandboxPaths.resolveCwd(tempDir, "/workspace"));
        assertEquals(backend.toRealPath(), SandboxPaths.resolveCwd(tempDir, "backend"));
        assertEquals(backend.toRealPath(), SandboxPaths.resolveCwd(tempDir, "/workspace/backend"));
    }

    @Test
    void rejectsCwdEscapes() {
        assertThrows(IOException.class, () -> SandboxPaths.resolveCwd(tempDir, "../"));
        assertThrows(IOException.class, () -> SandboxPaths.resolveCwd(tempDir, "/etc"));
    }

    @Test
    void rejectsSymlinkedCwdThatResolvesOutside() throws IOException {
        Path link = tempDir.resolve("escape");
        try {
            Files.createSymbolicLink(link, outsideDir);
        } catch (UnsupportedOperationException | IOException e) {
            return;
        }

        assertThrows(IOException.class, () -> SandboxPaths.resolveCwd(tempDir, "escape"));
    }

    @Test
    void mapsRemoteFilesIntoTheWorkspace() throws IOException {
        Path expected = tempDir.toRealPath().resolve("src/App.java");

        assertEquals(expected, SandboxPaths.remoteToLocal(tempDir, "/workspace/src/App.java"));
        assertEquals(expected, SandboxPaths.remoteToLocal(tempDir, "src/App.java"));
        assertThrows(IOException.class,
            () -> SandboxPaths.remoteToLocal(tempDir, "/workspace/../../etc/passwd"));
    }
}
