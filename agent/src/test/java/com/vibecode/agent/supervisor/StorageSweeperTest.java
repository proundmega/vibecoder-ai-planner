package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-58: runtime-root/legacy/temp sweep and orphan quarantine. */
class StorageSweeperTest {

    @TempDir
    Path tempDir;

    private void age(Path path, Duration duration) throws Exception {
        Files.setLastModifiedTime(path, FileTime.from(Instant.now().minus(duration)));
    }

    @Test
    void sweepsOldRuntimeRootsAndKeepsActiveMarkers() throws Exception {
        Path runtimeBase = tempDir.resolve("runtimes");
        Path old = Files.createDirectories(runtimeBase.resolve("12"));
        Files.createDirectories(runtimeBase.resolve("13/34"));
        age(old, Duration.ofHours(30));
        age(runtimeBase.resolve("13"), Duration.ofHours(30));
        Files.createFile(runtimeBase.resolve("13/34/.active"));

        int removed = StorageSweeper.sweepRuntimeRoots(
            runtimeBase, tempDir.resolve("orphans"), Duration.ofHours(24),
            Duration.ofHours(24), Set.of());

        assertFalse(Files.exists(old));
        assertTrue(Files.exists(runtimeBase.resolve("13")), "active root is kept");
        assertTrue(removed >= 1);
    }

    @Test
    void staleMarkerDoesNotPinARuntimeRoot() throws Exception {
        Path runtimeBase = tempDir.resolve("runtimes");
        Path root = Files.createDirectories(runtimeBase.resolve("12"));
        Path marker = Files.createFile(root.resolve(".active"));
        age(root, Duration.ofHours(72));
        age(marker, Duration.ofHours(72));

        int removed = StorageSweeper.sweepRuntimeRoots(
            runtimeBase, tempDir.resolve("orphans"), Duration.ofHours(24),
            Duration.ofHours(24), Set.of());

        assertFalse(Files.exists(root), "stale .active must not pin the root");
        assertEquals(1, removed);
    }

    @Test
    void sweepsLegacyAndTempPrefixes() throws Exception {
        Path legacy = Files.createDirectories(tempDir.resolve("abcdef12-repo"));
        Path temp = Files.createDirectories(tempDir.resolve("opencode-harness-x"));
        Path inactive = Files.createDirectories(tempDir.resolve("keep-me"));
        age(legacy, Duration.ofHours(30));
        age(temp, Duration.ofHours(30));
        age(inactive, Duration.ofHours(30));

        int removed = StorageSweeper.sweepLegacy(tempDir, tempDir, Duration.ofHours(24));

        assertFalse(Files.exists(legacy));
        assertFalse(Files.exists(temp));
        assertTrue(Files.exists(inactive));
        assertTrue(removed >= 2);
    }

    @Test
    void deletesOrphansAfterTheQuarantineTtl() throws Exception {
        Path orphans = Files.createDirectories(tempDir.resolve("orphans/old-1"));
        age(orphans, Duration.ofHours(30));

        int removed = StorageSweeper.sweepOrphans(tempDir.resolve("orphans"),
            Duration.ofHours(24));

        assertFalse(Files.exists(orphans));
        assertTrue(removed >= 1);
    }
}
