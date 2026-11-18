package com.vibecode.agent.enrollment;

import com.vibecode.agent.service.AgentCredentialStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.Set;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class AgentCredentialStoreTest {

    @TempDir
    Path tempDir;

    private AgentCredentialStore.Credentials credentials() {
        return new AgentCredentialStore.Credentials(
            "42",
            "at_access",
            "ar_refresh",
            Instant.parse("2026-01-01T00:00:00Z"),
            Instant.parse("2026-02-01T00:00:00Z"),
            "3");
    }

    @Test
    void savesAndLoadsCredentialsAtomically() throws IOException {
        Path file = tempDir.resolve("volume/credentials.json");
        AgentCredentialStore store = new AgentCredentialStore(file);

        store.save(credentials());

        assertTrue(store.exists());
        AgentCredentialStore.Credentials loaded = store.load();
        assertEquals("42", loaded.agentId());
        assertEquals("at_access", loaded.accessToken());
        assertEquals("ar_refresh", loaded.refreshToken());
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"), loaded.accessExpiresAt());
    }

    @Test
    void writesOwnerOnlyPermissions() throws IOException {
        Path file = tempDir.resolve("credentials.json");
        AgentCredentialStore store = new AgentCredentialStore(file);
        store.save(credentials());

        try {
            Set<PosixFilePermission> mode = Files.getPosixFilePermissions(file);
            assertTrue(mode.contains(PosixFilePermission.OWNER_READ));
            assertTrue(mode.contains(PosixFilePermission.OWNER_WRITE));
            assertFalse(mode.contains(PosixFilePermission.GROUP_READ));
            assertFalse(mode.contains(PosixFilePermission.OTHERS_READ));
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX filesystem in the test runner.
        }
    }

    @Test
    void leavesNoTemporaryFileBehind() throws IOException {
        Path file = tempDir.resolve("credentials.json");
        new AgentCredentialStore(file).save(credentials());

        try (Stream<Path> entries = Files.list(tempDir)) {
            assertFalse(entries.anyMatch(path -> path.getFileName().toString().endsWith(".tmp")));
        }
    }

    @Test
    void rejectsAMalformedCredentialFile() throws IOException {
        Path file = tempDir.resolve("credentials.json");
        Files.writeString(file, "{\"agentId\":\"42\"}");

        assertThrows(IOException.class, () -> new AgentCredentialStore(file).load());
    }
}
