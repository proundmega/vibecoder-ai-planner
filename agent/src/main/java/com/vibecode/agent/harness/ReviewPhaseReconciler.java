package com.vibecode.agent.harness;

import java.io.IOException;

/**
 * Ensures the ticket phase before a review and before an approval
 * (fg-31d, FR6).
 *
 * <p>Agent-built tickets reach {@code status=review} with a draft/in-progress
 * phase, so the phase is reconciled to {@code review} first. Immediately before
 * an approval the phase is re-checked; a moved phase returns {@code false} so
 * the caller posts a COMMENT and escalates to a human. This class can never
 * transition to {@code done}.</p>
 */
public final class ReviewPhaseReconciler {

    private final PhaseClient phases;

    public ReviewPhaseReconciler(PhaseClient phases) {
        if (phases == null) {
            throw new IllegalArgumentException("PhaseClient is required");
        }
        this.phases = phases;
    }

    /**
     * @return the reconciled {@code review} phase
     * @throws ReconciliationException when the phase is still not review
     */
    public String ensureReviewPhase(long ticketId) throws IOException {
        String phase = phases.currentPhase(ticketId);
        if ("review".equals(phase)) {
            return phase;
        }
        phases.reconcileToReview(ticketId);
        String reconciled = phases.currentPhase(ticketId);
        if (!"review".equals(reconciled)) {
            throw new ReconciliationException(
                "Ticket " + ticketId + " phase is '" + reconciled
                    + "' after reconciliation; approval is not allowed");
        }
        return reconciled;
    }

    /**
     * Re-check {@code phase=review} immediately before approval and move to
     * {@code human_approval}. Returns false when the phase moved away.
     */
    public boolean approve(long ticketId) throws IOException {
        String phase = phases.currentPhase(ticketId);
        if (!"review".equals(phase)) {
            return false;
        }
        phases.transitionToHumanApproval(ticketId);
        return true;
    }

    public interface PhaseClient {
        String currentPhase(long ticketId) throws IOException;

        void reconcileToReview(long ticketId) throws IOException;

        void transitionToHumanApproval(long ticketId) throws IOException;
    }

    public static final class ReconciliationException extends IOException {
        public ReconciliationException(String message) {
            super(message);
        }
    }
}
