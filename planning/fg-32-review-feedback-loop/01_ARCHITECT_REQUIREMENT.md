# 01_ARCHITECT_REQUIREMENT.md - Review Feedback Loop / Fixer Agent (fg-32)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Revised:** 2026-11-02 (addresses PR #104 design review)
**Depends on:** fg-31 Automatic Review Harness (merged, PR #103), fg-30 Phase 1 harness supervisor; fg-30 Phase 3 for token/cost budgets
**Related code:** `ReviewProcessor`, `HarnessTicketProcessor`, `WorkspaceManager`, `PhaseService`, `CodeReview.vue`, `PhaseReview.vue`

## Problem

When the reviewer proposes changes, the loop stops. There is no automatic path from review findings back to a Java agent that can correct the branch.

Current behavior:

- The build agent polls `status=backlog` only (`ApiService.listBacklogTickets`, `AgentApp.processCycle`); `in_progress` and `review` are not claimable.
- The legacy `ReviewProcessor` posts `status`/`comment` messages on rejection and leaves the ticket in `review`. Nothing triggers a fixer.
- `ApiService.getMessages()` exists but has no callers. Agent prompts include planning docs, not ticket messages or review findings.
- The frontend "Request changes" paths transition `review -> in_progress` directly: `CodeReview.vue` sends `metadata.reason`, while `PhaseReview.vue` sends `metadata.feedback`. No agent polls `in_progress`, and neither key is consumed by agent code.
- `PhaseService` allows `review -> in_progress` and `review -> backlog`, but no review result triggers either transition automatically.
- There is no reviewed-SHA/round counter, no same-branch checkout, no re-review trigger and no escalation rule.
- fg-31 writes the review attempt/findings and posts the COMMENT review, but does not create a fix request.

## Goals

1. Turn a `request_changes` verdict into a durable, structured **fix request** created from the fg-31 attempt.
2. Deliver findings to a Java fixer agent with enough context to correct the same branch and PR.
3. Let the fixer claim the request atomically, update the existing branch, verify, and hand it back to `review`.
4. Trigger a re-review of the new SHA, with bounded rounds and no duplicate work.
5. Escalate to a human when rounds are exhausted, progress stalls, or the branch moved.
6. Keep the reviewer, fixer and publisher roles separate and auditable.
7. Keep the loop off by default per project until dogfooding proves it safe.

## Non-goals

- Auto-merge. Merging remains human/reviewer controlled.
- Reviewing or fixing PRs that are not linked to a planner ticket.
- Multiple fixers working the same ticket in parallel.
- Replacing human approval.
- Real-time chat between reviewer and fixer.
- Writing review attempts/findings (owned by fg-31).

## Functional requirements

- **FR1 - Structured request:** fg-31 persists the completed attempt/findings and calls `POST /tickets/:id/review/request-changes` with `attempt_id`; fg-32 creates exactly one fix request for that attempt. The endpoint is idempotent and fg-32 does not poll attempts.
- **FR2 - Fix state:** move the ticket `review -> in_progress` (phase **and** status) with `review_state=changes_requested`, preserving the PR/branch link. A dedicated `fixing` phase is out of scope for Phase 1.
- **FR3 - Queue:** expose `GET /agents/fix-queue?projectId=` to agents, scoped to project and agent permissions, at most one active request per ticket.
- **FR4 - Atomic claim and lease:** claim a request with a DB lock/lease so only one fixer works a ticket; include `lease_expires_at`, heartbeat renewal via `POST /tickets/:id/fix/renew`, and a reclaim path after expiry.
- **FR5 - Existing branch, pinned base:** resolve the branch from `tickets.branch_name` (populated by the agent build path when the PR is created) or the GitHub PR head ref; the fixer checks out that branch (not a new one), confirms `HEAD == reviewed_sha`, and uses `reviewed_sha` as the commit parent/diff base.
- **FR6 - Context:** the fix prompt includes the ticket, planning docs, current findings, previous verification failures, previous diff summary, round number, and constraints.
- **FR7 - Verification and fast-forward publish:** the fixer runs verification, commits, and publishes **fast-forward only**; never force-push, force-with-lease or rewrite the shared branch. Abort if the remote head moved from `reviewed_sha`.
- **FR8 - Hand back:** on success transition `in_progress -> review` (phase + status, not status alone) with `review_state=awaiting_review` and the new head SHA; the reviewer re-reviews.
- **FR9 - Bounded rounds and escalation:** round 0 is the initial review; increment the round on each accepted request-changes. `FIX_MAX_ROUNDS=2` means 2 fix rounds after the initial review (3 reviews total). Escalation is phase-aware: `review -> human_approval` when in `review`, `in_progress -> review -> human_approval` when in `in_progress`, and a no-op when already in `human_approval`; other phases fail closed. `in_progress -> human_approval` is never attempted.
- **FR10 - No-progress rule:** if the fixer produces no new commit, the same critical findings persist, verification fails identically twice, or the remote branch moved, stop and escalate instead of spending more rounds.
- **FR11 - Manual and automatic dispatch:** `FIX_LOOP_MODE=off|manual|auto` and `projects.fix_loop_mode` control dispatch. Humans create requests through a JWT path or the `PhaseService.transition()` hook; both normalize `metadata.reason` and `metadata.feedback` into `feedback`. Manual requests resolve `reviewed_sha` from the latest completed attempt or the PR head, and include `feedback` in the fix prompt. Branch resolution uses `tickets.branch_name` (written on PR creation by both build paths and exposed via `Ticket.fromRow`) or the PR head ref.
- **FR12 - Failure handling:** a failed fixer clears the lease, increments `attempts`, and resets the request to `queued` with `next_attempt_at` backoff and `review_state=changes_requested` while attempts remain; at `FIX_MAX_ATTEMPTS` (default 3) it sets `failed`/`fix_failed`, then escalates and sets `review_state=escalated`. The queue selects only due `queued` rows; `failed` is terminal and never claimable. A ticket must never be left in `in_progress` with no claimable queue entry or lease.

## Safety requirements

- Fixer cannot merge, force-push, rewrite history, or push to a different branch.
- Publishing is fast-forward only and re-checks the remote head immediately before push; a moved branch aborts and the human commit wins.
- Publishing uses the same supervisor guard as fg-30 (protected paths, diff caps, redaction).
- One active fixer per ticket; stale leases expire and are reclaimable with an audit event.
- Reviewer and fixer run as distinct agent identities; neither can merge or self-approve. In Phase 1 the reviewer posts COMMENT-only GitHub reviews and the human gate decides.
- No provider key, GitHub token or server password in findings, prompts, logs or messages.
- Phase 1 enforces `FIX_MAX_DURATION_MINUTES` and fg-30 diff caps as hard stops. Token/cost budgets are not enforced until fg-30 Phase 3 lands.
- Human approval remains the final gate.

## Acceptance criteria

1. A `request_changes` verdict creates exactly one structured fix request keyed by `attempt_id`, visible to agents and humans.
2. A fixer claims it atomically, resolves the branch from `tickets.branch_name` (written by the build path) or the PR head, checks out that branch at `reviewed_sha`, and publishes a new commit without opening a second PR.
3. The fixer never overwrites a human push: a moved remote head aborts the publish with `remote_head_moved`.
4. The reviewer automatically reviews the new SHA and the ticket records the new round.
5. Approved fixes route to `human_approval`; rejected fixes can run up to `FIX_MAX_ROUNDS` fix rounds before escalation.
6. Exceeding `FIX_MAX_ROUNDS`, no progress, repeated verification failure, or a moved branch escalates phase-aware: `review -> human_approval` in `review`, `in_progress -> review -> human_approval` in `in_progress`, and a no-op in `human_approval`; other phases fail closed.
7. A manual request resolves `reviewed_sha` (latest completed attempt or PR head) and its branch (branch_name or PR head), and its `feedback` reaches the fixer prompt.
8. Duplicate requests, claims, reviews and pushes are prevented (`UNIQUE(attempt_id)`, one active request per ticket, lease).
9. The loop is disabled by default and can be enabled per project (`projects.fix_loop_mode`) with the global flag as the default.
10. Unit/contract tests cover claim race, same-branch checkout, fast-forward-only publish, moved-head abort, findings parsing, failed->queued retry, phase-aware escalation and round limits.
11. No secrets appear in logs, prompts, findings or PR text.
12. The `review_state` cache is `changes_requested` while a request is queued, `fixing` while claimed, and `fix_failed`/`escalated` on termination.

## Out of scope

- Auto-merge.
- Multi-agent parallel fixers.
- Cross-repository fixes.
- Review/fix analytics dashboards.
- Changing fg-30 build mode semantics for backlog tickets.
- Writing review attempts/findings (fg-31).
- Token/cost budget enforcement until fg-30 Phase 3.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-31 | Structured finding store and GitHub PR reviews | Agent / Review | TBD (delivered by fg-31 Phase 1) | No |
| 2 | fg-30 | Human question loop for ambiguous findings | Agent / UX | `fg-30` Phase 2 | No |
| 3 | new | Email notifications for fix requests and escalations (no existing email-notification ticket; bp-71 is account lockout) | UX | TBD | No |
| 4 | bp-106 | Ship fix/review events to log aggregation | Observability | TBD (new follow-up) | No |
| 5 | bp-04 | Fix/review cost dashboard | Observability / Billing | TBD (new follow-up) | No |
| 6 | bp-99-frontend-testing | E2E coverage for the fix loop UI | Testing | TBD (new follow-up) | No |

`From Ticket` records where the deferred improvement was found; `TBD` means no follow-up ticket exists yet, so this table does not imply one is already tracked.
