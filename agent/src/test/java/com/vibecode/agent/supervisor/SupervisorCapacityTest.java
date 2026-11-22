package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * fg-43 capacity guard: host-init.sh sizes the declaration and the supervisor
 * refuses to run a fleet larger than that budget.
 */
class SupervisorCapacityTest {

    private static RuntimeConfig sevenRuntimes() {
        return RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/claude-sonnet
            count = 3
            project = 1

            [runtime "reviewers"]
            role = reviewer
            model = acme/claude-opus
            count = 2

            [runtime "planners"]
            role = planner
            model = acme/claude-sonnet
            count = 2
            """);
    }

    @Test
    void parsesTheHostRuntimesCap() {
        assertEquals(50, SupervisorMain.hostMaxRuntimes(null));
        assertEquals(50, SupervisorMain.hostMaxRuntimes(""));
        assertEquals(0, SupervisorMain.hostMaxRuntimes(" 0 "));
        assertEquals(7, SupervisorMain.hostMaxRuntimes("7"));
        assertThrows(IllegalArgumentException.class,
            () -> SupervisorMain.hostMaxRuntimes("-1"));
        assertThrows(IllegalArgumentException.class,
            () -> SupervisorMain.hostMaxRuntimes("seven"));
    }

    @Test
    void theSevenRuntimeReferenceCaseFitsItsBudget() {
        RuntimeConfig config = sevenRuntimes();

        assertEquals(7, config.expandedSlots().size());
        assertDoesNotThrow(() -> SupervisorMain.enforceHostCapacity(config, 7));
        assertDoesNotThrow(() -> SupervisorMain.enforceHostCapacity(config, 50));
        // 0 disables the guard for hand-managed hosts.
        assertDoesNotThrow(() -> SupervisorMain.enforceHostCapacity(config, 0));
    }

    @Test
    void anOverCapacityDeclarationFailsClosed() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> SupervisorMain.enforceHostCapacity(sevenRuntimes(), 6));

        assertTrue(error.getMessage().contains("7 runtime slots"));
        assertTrue(error.getMessage().contains("AGENT_HOST_MAX_RUNTIMES=6"));
        assertTrue(error.getMessage().contains("host-init.sh"));
    }
}
