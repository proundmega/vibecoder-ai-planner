# 00_ARCHITECT_CHECKLIST.md - Review Feedback Loop / Fixer Agent (fg-32)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Revised:** 2026-11-02 (addresses PR #104 design review)
**Depends on:** fg-31 Automatic Review Harness (merged, PR #103), fg-30 Phase 1 harness supervisor; fg-30 Phase 3 for token/cost budgets
**Related code:** `ReviewProcessor`, `HarnessTicketProcessor`, `WorkspaceManager`, `PhaseService`, `CodeReview.vue`, `PhaseReview.vue`

## Why this ticket exists

Today the reviewer can say "request changes", but nothing routes those findings back to a Java agent. The review comments are free-text ticket messages that no agent reads, the ticket stays in `review`, and the build agent only polls `backlog`. There is no fixer worker, no reviewed-SHA/round tracking, no same-branch update and no escalation rule.

fg-31 defines and now implements the reviewer, its attempt/finding store and the GitHub COMMENT review. This ticket owns the concrete feedback channel, the fix queue/lease, the Java fixer execution and the human escalation path.

## Resolved decisions

- Fix state uses `in_progress` + `review_state`; no new phase.
- fg-31 writes the completed attempt/findings; fg-32's endpoint consumes `attempt_id` and creates the fix request idempotently.
- Escalation is phase-aware: `review -> human_approval`, `in_progress -> review -> human_approval`, or a no-op in `human_approval`; `in_progress -> human_approval` is never attempted.
- Publishing is fast-forward only and pinned to `reviewed_sha`; the existing `pushCommit()` force-with-lease path is not used for shared PR branches.
- Worker mode is `AGENT_MODE=fix`; `FIX_LOOP_MODE` only controls dispatch.
- Fix requests live in `ticket_fix_requests`; review attempts/findings stay in the fg-31 schema.
- Per-project enablement is `projects.fix_loop_mode`, defaulting to off; the global `FIX_LOOP_MODE` is the default.

## Checklist

- [ ] Implement the decided fix state: `review -> in_progress` + `review_state` (no new phase)
- [ ] Use the fg-31 `ticket_review_attempts` + `ticket_review_findings` schema; do not fork it
- [ ] Add `ticket_fix_requests` with `attempt_id`, branch, reviewed SHA, state, lease owner/expiry, attempts and last error
- [ ] Populate `tickets.branch_name` from the agent build path (post-PR update) and expose it via `Ticket.fromRow`; resolve from the PR head as fallback
- [ ] Define the fix-request creation contract (fg-31 calls the endpoint with `attempt_id`; idempotent)
- [ ] Define the structured findings contract and version it
- [ ] Define the fix queue/claim API with atomic locking, lease TTL and `POST /tickets/:id/fix/renew`
- [ ] Enforce one active fix request per ticket and `UNIQUE(attempt_id)`
- [ ] Implement `FIX_LOOP_MODE=off|manual|auto` and `projects.fix_loop_mode` (decided)
- [ ] Add the human JWT path (`TICKET_STATUS_CHANGE`) and normalize `metadata.reason` / `metadata.feedback`
- [ ] Set max rounds (2 fix rounds after round 0), `FIX_MAX_ATTEMPTS` (default 3) and the no-progress rule
- [ ] Propagate `AGENT_MODE` and `FIX_*` through `AgentConfig`, the existing `PoolManager` env allowlist, `agent/.env.example` and README
- [ ] Implement phase-aware escalation (`review -> human_approval`, `in_progress -> review -> human_approval`, no-op in `human_approval`) and phase-history audit
- [ ] Resolve `reviewed_sha` for manual requests (latest completed attempt, else PR head) and include `feedback` in the fix prompt
- [ ] Make `fix/fail` reset to `queued` with `next_attempt_at` backoff; select only due queued rows; escalate at `FIX_MAX_ATTEMPTS`
- [ ] Keep the `review_state` cache consistent: `changes_requested` on requeue, `fixing` on claim, `fix_failed`/`escalated` on termination
- [ ] Add `AGENT_MODE=fix` wiring for `FixTicketProcessor` with a distinct agent identity
- [ ] Add `WorkspaceManager` support for checking out an existing PR branch pinned to `reviewed_sha`
- [ ] Add a fast-forward-only publish path; do not reuse `pushCommit()` for shared PR branches
- [ ] Abort on `remote_head_moved` and never overwrite a human push
- [ ] Add findings + previous verification to the fixer prompt
- [ ] Route successful fixes back to `review` on the same branch/PR with the new SHA
- [ ] Add human escalation when rounds are exhausted, progress stalls, or the branch moved
- [ ] Define the source-of-truth/update order between attempts, fix requests and ticket cache fields
- [ ] Define Phase 1 budgets (wall clock + diff caps) and record token/cost as dependent on fg-30 Phase 3
- [ ] Add migration + rollback for `ticket_fix_requests` and `projects.fix_loop_mode`
- [ ] Add OpenAPI/JSDoc, regenerate TS types, and validate responses
- [ ] Mount the review sub-router before generic `/tickets/:ticketId` handlers; keep `/agents/fix-queue` in the existing `/agents` router
- [ ] Add backend, agent and contract tests
- [ ] Add frontend unit/component tests for the review panel, manual request and escalation states
- [ ] Dogfood reviewer -> fixer -> reviewer on a real PR before enabling auto mode
- [ ] Keep the loop off by default until proven
