package com.vibecode.agent.harness;

import com.vibecode.agent.service.WorkspaceManager;
import com.vibecode.agent.supervisor.StoragePolicy;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-44: terminal cleanup, sandbox-first delete and budget breach. */
class HarnessTicketProcessorStorageTest {

    @TempDir
    Path tempDir;

    @Test
    void terminalCleanupDeletesTheTicketWorkspaceAndMarker() throws Exception {
        Path runtimeRoot = tempDir.resolve("12");
        WorkspaceManager manager = new WorkspaceManager(
            runtimeRoot.toString(), "repo", false, null, null, "34");
        Files.createDirectories(manager.getWorkspaceRoot().resolve("repo"));
        manager.writeActiveMarker("run-1");
        assertTrue(Files.exists(manager.getWorkspaceRoot().resolve(".active")));

        manager.cleanup("34");

        assertFalse(Files.exists(manager.getWorkspaceRoot()));
        assertTrue(Files.exists(runtimeRoot));
    }

    @Test
    void roleBudgetAndOverrideDriveTheBreachThreshold() {
        assertEquals(20, StoragePolicy.budgetGbFor("worker", null));
        assertEquals(10, StoragePolicy.budgetGbFor("reviewer", null));
        assertEquals(5, StoragePolicy.budgetGbFor("light", null));
        assertEquals(3, StoragePolicy.budgetGbFor("worker", "3"));
    }
}
