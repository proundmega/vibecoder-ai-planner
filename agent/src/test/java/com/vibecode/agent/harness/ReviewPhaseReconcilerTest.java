package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewPhaseReconcilerTest {

    @Test
    void leavesAnAlreadyReviewPhaseAlone() throws Exception {
        FakePhases phases = new FakePhases("review");

        String phase = new ReviewPhaseReconciler(phases).ensureReviewPhase(42L);

        assertEquals("review", phase);
        assertEquals(0, phases.reconcileCalls);
    }

    @Test
    void reconcilesADraftPhaseToReview() throws Exception {
        FakePhases phases = new FakePhases("draft");
        phases.afterReconcile = "review";

        String phase = new ReviewPhaseReconciler(phases).ensureReviewPhase(42L);

        assertEquals("review", phase);
        assertEquals(1, phases.reconcileCalls);
    }

    @Test
    void failsClosedWhenReconciliationDoesNotReachReview() {
        FakePhases phases = new FakePhases("draft");
        phases.afterReconcile = "planning";

        assertThrows(ReviewPhaseReconciler.ReconciliationException.class,
            () -> new ReviewPhaseReconciler(phases).ensureReviewPhase(42L));
    }

    @Test
    void refusesToReconcileTerminalOrApprovalPhases() {
        for (String phase : List.of("done", "deployed", "human_approval", "blocked")) {
            FakePhases phases = new FakePhases(phase);

            assertThrows(ReviewPhaseReconciler.ReconciliationException.class,
                () -> new ReviewPhaseReconciler(phases).ensureReviewPhase(42L),
                "phase " + phase);
            assertEquals(0, phases.reconcileCalls, "phase " + phase);
        }
    }

    @Test
    void refusesANullPhase() {
        FakePhases phases = new FakePhases(null);

        assertThrows(ReviewPhaseReconciler.ReconciliationException.class,
            () -> new ReviewPhaseReconciler(phases).ensureReviewPhase(42L));
        assertEquals(0, phases.reconcileCalls);
    }

    @Test
    void approvalRechecksReviewBeforeTransitioning() throws Exception {
        FakePhases phases = new FakePhases("review");

        boolean approved = new ReviewPhaseReconciler(phases).approve(42L);

        assertTrue(approved);
        assertEquals(1, phases.approvalCalls);
        assertEquals("human_approval", phases.lastTransition);
    }

    @Test
    void approvalIsRefusedWhenThePhaseMoved() throws Exception {
        FakePhases phases = new FakePhases("in_progress");

        boolean approved = new ReviewPhaseReconciler(phases).approve(42L);

        assertFalse(approved);
        assertEquals(0, phases.approvalCalls);
    }

    @Test
    void approvalFailsWhenTheTransitionDoesNotReachHumanApproval() throws Exception {
        FakePhases phases = new FakePhases("review");
        phases.afterTransition = "review";

        boolean approved = new ReviewPhaseReconciler(phases).approve(42L);

        assertFalse(approved);
        assertEquals(1, phases.approvalCalls);
    }

    private static final class FakePhases implements ReviewPhaseReconciler.PhaseClient {

        private String phase;
        private String afterReconcile;
        private String afterTransition = "human_approval";
        private int reconcileCalls;
        private int approvalCalls;
        private String lastTransition;

        private FakePhases(String phase) {
            this.phase = phase;
            this.afterReconcile = phase;
        }

        @Override
        public String currentPhase(long ticketId) {
            return phase;
        }

        @Override
        public void reconcileToReview(long ticketId) {
            reconcileCalls++;
            phase = afterReconcile;
        }

        @Override
        public void transitionToHumanApproval(long ticketId) {
            approvalCalls++;
            lastTransition = "human_approval";
            phase = afterTransition;
        }
    }
}
