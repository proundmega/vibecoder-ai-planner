# 01_ARCHITECT_REQUIREMENT.md - Review Feedback Loop / Fixer Agent (fg-32)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-31 Automatic Review Harness, fg-30 Phase 1 harness supervisor
**Related code:** `ReviewProcessor`, `HarnessTicketProcessor`, `WorkspaceManager`, `PhaseService`, `CodeReview.vue`

## Problem

When the reviewer proposes changes, the loop stops. There is no automatic path from review findings back to a Java agent that can correct the branch.

Current behavior:

- The build agent polls `status=backlog` only (`ApiService.listBacklogTickets`, `AgentApp.processCycle`); `in_progress` and `review` are not claimable.
- The legacy `ReviewProcessor` posts `status`/`comment` messages on rejection and leaves the ticket in `review`. Nothing triggers a fixer.
- `ApiService.getMessages()` exists but has no callers. Agent prompts include planning docs, not ticket messages or review findings.
- The frontend "Request changes" button transitions `review -> in_progress` with `metadata.reason`, but no agent polls `in_progress`, and the reason is not consumed by agent code.
- `PhaseService` allows `review -> in_progress` and `review -> backlog`, but no review result triggers either transition automatically.
- There is no reviewed-SHA/round counter, no same-branch checkout, no re-review trigger and no escalation rule.
- fg-31 plans the reviewer and its verdict; it does not define the feedback channel or the Java fixer execution.

## Goals

1. Turn a `request_changes` verdict into a durable, structured **fix request**.
2. Deliver findings to a Java fixer agent with enough context to correct the same branch and PR.
3. Let the fixer claim the request atomically, update the existing branch, verify, and hand it back to `review`.
4. Trigger a re-review of the new SHA, with bounded rounds and no duplicate work.
5. Escalate to a human when rounds are exhausted, progress stalls, or verification keeps failing.
6. Keep the reviewer, fixer and publisher roles separate and auditable.
7. Keep the loop off by default until dogfooding proves it safe.

## Non-goals

- Auto-merge. Merging remains human/reviewer controlled.
- Reviewing or fixing PRs that are not linked to a planner ticket.
- Multiple fixers working the same ticket in parallel.
- Replacing human approval.
- Real-time chat between reviewer and fixer.

## Functional requirements

- **FR1 - Structured request:** on `request_changes`, persist the verdict, reviewed SHA, round, findings and supervisor-captured verification results in the fg-31 attempt/finding tables.
- **FR2 - Fix state:** move the ticket to a fixable state (`in_progress` + `review_state=changes_requested`, or a new `fixing` phase) without losing the PR/branch link.
- **FR3 - Queue:** expose a fix queue to agents, scoped to project and agent permissions.
- **FR4 - Atomic claim:** claim a fix request with a DB lock/lease so only one fixer works a ticket; include a TTL and heartbeat.
- **FR5 - Existing branch:** the fixer checks out the PR branch (not a new branch), confirms the reviewed SHA, and works from it.
- **FR6 - Context:** the fix prompt includes the ticket, planning docs, current findings, previous verification failures, previous diff summary, round number, and constraints.
- **FR7 - Verification and publish:** the fixer runs verification, commits to the same branch, pushes through the supervisor, and never merges.
- **FR8 - Hand back:** on success the ticket returns to `review` with `review_state=awaiting_review` and the new head SHA; the reviewer re-reviews.
- **FR9 - Bounded rounds:** round 0 is the initial review; increment the round on each accepted request-changes. `FIX_MAX_ROUNDS=2` means 2 fix rounds after the initial review (3 reviews total), then escalate to `human_approval`/a human.
- **FR10 - No-progress rule:** if the fixer produces no new commit, or the same critical findings persist, stop and escalate instead of spending more rounds.
- **FR11 - Manual and automatic dispatch:** support human-triggered "send to fixer" first; automatic dispatch behind `FIX_LOOP_MODE=auto`.
- **FR12 - Failure handling:** release the claim, post a clear failure, keep the ticket in the fixable/review state, and never approve.

## Safety requirements

- Fixer cannot merge, force-push, rewrite history, or push to a different branch.
- Publishing uses the same supervisor guard as fg-30 (protected paths, diff caps, redaction).
- One active fixer per ticket; stale leases expire and are reclaimable with an audit event.
- Reviewer and fixer run as distinct agent identities; neither can merge or self-approve. In Phase 1 the reviewer posts COMMENT-only GitHub reviews and the human gate decides.
- No provider key, GitHub token or server password in findings, prompts, logs or messages.
- Round, cost and token budgets are enforced, not advisory.
- Human approval remains the final gate.

## Acceptance criteria

1. A `request_changes` verdict creates a structured fix request visible to agents and humans.
2. A fixer claims it atomically, checks out the existing PR branch, and pushes a new commit without opening a second PR.
3. The reviewer automatically reviews the new SHA and the ticket records the new round.
4. Approved fixes route to `human_approval`; rejected fixes can run up to `FIX_MAX_ROUNDS` fix rounds before escalation.
5. Exceeding `FIX_MAX_ROUNDS`, no progress, or repeated verification failure escalates to a human.
6. Duplicate claims, duplicate reviews and duplicate pushes are prevented.
7. The loop is disabled by default and can be enabled per project.
8. Unit/contract tests cover claim race, same-branch checkout, findings parsing, round limits and no-progress escalation.
9. No secrets appear in logs, prompts, findings or PR text.

## Out of scope

- Auto-merge.
- Multi-agent parallel fixers.
- Cross-repository fixes.
- Review/fix analytics dashboards.
- Changing fg-30 build mode semantics for backlog tickets.

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
