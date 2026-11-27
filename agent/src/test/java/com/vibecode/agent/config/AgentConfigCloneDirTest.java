package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AgentConfigCloneDirTest {

    /**
     * Static so it is initialized before the superclass constructor calls the
     * overridden getter.
     */
    private static Path isolatedCloneDir;

    private static void setCloneDir(AgentConfig config, Path dir) throws Exception {
        Field cloneDir = AgentConfig.class.getDeclaredField("repoCloneDir");
        cloneDir.setAccessible(true);
        cloneDir.set(config, dir.toString());
    }

    @Test
    void leftoverProbePathDoesNotBlockValidation(@TempDir Path temp) throws Exception {
        Path cloneDir = Files.createDirectories(temp.resolve("clone"));
        // A crashed or foreign run may have left a path at the fixed probe
        // name; validation must not depend on it.
        Files.createDirectories(cloneDir.resolve(".write-test"));

        AgentConfig config = new AgentConfig();
        setCloneDir(config, cloneDir);

        config.setRepoCoordinates("probe-owner", "probe-repo");

        assertEquals("probe-owner", config.getRepoOwner());
        assertEquals("probe-repo", config.getRepoName());
    }

    @Test
    void validationUsesTheCloneDirGetter(@TempDir Path temp) throws Exception {
        isolatedCloneDir = Files.createDirectories(temp.resolve("isolated"));
        AgentConfig config = new AgentConfig() {
            @Override
            public String getRepoCloneDir() {
                return isolatedCloneDir.toString();
            }
        };

        config.setRepoCoordinates("getter-owner", "getter-repo");

        assertEquals("getter-owner", config.getRepoOwner());
    }

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
