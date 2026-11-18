package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AgentConfigCloneDirTest {

    @Test
    void failedCloneDirValidationKeepsTheEnvCoordinates(@TempDir Path temp) throws Exception {
        AgentConfig config = new AgentConfig();
        config.setRepoCoordinates("env-owner", "env-repo");

        Path notADirectory = temp.resolve("not-a-dir");
        Files.writeString(notADirectory, "x");
        Field cloneDir = AgentConfig.class.getDeclaredField("repoCloneDir");
        cloneDir.setAccessible(true);
        cloneDir.set(config, notADirectory.toString());

        assertThrows(IllegalStateException.class,
            () -> config.setRepoCoordinates("server-owner", "server-repo"));

        assertEquals("env-owner", config.getRepoOwner());
        assertEquals("env-repo", config.getRepoName());
    }
}
