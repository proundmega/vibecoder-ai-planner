package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-54: the runtime role replaces the client-asserted mode. */
class AgentConfigRoleTest {

    @Test
    void parsesOnlyTheClosedRoleEnum() {
        assertEquals("worker", AgentConfig.parseRole(" WORKER "));
        assertEquals("reviewer", AgentConfig.parseRole("reviewer"));
        assertEquals("planner", AgentConfig.parseRole("planner"));
        assertEquals("worker", AgentConfig.parseRole(null));
        assertThrows(IllegalStateException.class, () -> AgentConfig.parseRole("super-agent"));
    }

    @Test
    void normalizesAndRejectsUnknownEffort() {
        assertEquals("max", AgentConfig.parseEffort(" MAX "));
        assertEquals("medium", AgentConfig.parseEffort("normal"));
        assertNull(AgentConfig.parseEffort(null));
        assertThrows(IllegalStateException.class,
            () -> AgentConfig.parseEffort("maximum-effort"));
    }

    @Test
    void roleDecidesWhetherTheBuildLoopRuns() {
        WorkerConfig worker = new WorkerConfig();
        assertTrue(worker.isBuildMode());
        assertFalse(worker.isReviewMode());

        ReviewerConfig reviewer = new ReviewerConfig();
        assertFalse(reviewer.isBuildMode());
        assertTrue(reviewer.isReviewMode());
        assertTrue(reviewer.isReviewer());

        PlannerConfig planner = new PlannerConfig();
        assertTrue(planner.isPlanner());
        assertTrue(planner.isReviewMode());
    }

    private static final class WorkerConfig extends AgentConfig {
        @Override public String getRole() { return "worker"; }
    }

    private static final class ReviewerConfig extends AgentConfig {
        @Override public String getRole() { return "reviewer"; }
    }

    private static final class PlannerConfig extends AgentConfig {
        @Override public String getRole() { return "planner"; }
    }
}
