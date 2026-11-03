# 03 — Implementation (fg-32)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan (original; plan merged in #104; implementation pending)

> Implementation is pending. This is the work breakdown from the design phase; D6 in `00` remains open.

- [ ] Implement the decided fix state: `review -> in_progress` + `review_state` (no new phase)
- [ ] Use the fg-31 `ticket_review_attempts` + `ticket_review_findings` schema; do not fork it
- [ ] Add `ticket_fix_requests` with `attempt_id`, branch, reviewed SHA, state, lease owner/expiry, attempts and last error
- [ ] Populate `tickets.branch_name` from the agent build path (post-PR update) and expose it via `Ticket.fromRow`; resolve from the PR head as fallback
- [ ] Define the fix-request creation contract (fg-31 calls the endpoint with `attempt_id`; idempotent)
- [ ] Define the structured findings contract and version it
- [ ] Define the fix queue/claim API with atomic locking, lease TTL and `POST /tickets/:id/fix/renew`
- [ ] Enforce one active fix request per ticket and `UNIQUE(attempt_id)`
- [ ] Add an explicit fixer-only allow path for fg-33's publish-evidence `startRun` guard; require a claimed fix request, matching branch and `reviewed_sha`, and keep the normal build start refused (FR13)
- [ ] Implement the fixer harness run lifecycle: `startRun` with `purpose=fix`/`fix_request_id`/`base_sha=reviewed_sha`, checkpoints, heartbeat, `finishRun`, and the same-owner identity rule (FR13)
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

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-31, fg-30, fg-33

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | | | | |
| FR2 | | | | |
| FR3 | | | | |
| FR4 | | | | |
| FR5 | | | | |
| FR6 | | | | |
| FR7 | | | | |
| FR8 | | | | |
| FR9 | | | | |
| FR10 | | | | |
| FR11 | | | | |
| FR12 | | | | |
| FR13 | | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
