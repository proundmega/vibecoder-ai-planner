# 01_ARCHITECT_REQUIREMENT.md - Automatic Review Harness (fg-31)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Revised:** 2026-11-01 (addresses PR #103 design review)
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor), fg-30 Phase 2 (human question loop), fg-32 (#104) for fix dispatch, rounds and findings consumption
**Related code:** legacy `ReviewProcessor`, `HarnessTicketProcessor.markReview()`, `PhaseService`, `GET /tickets/:id/review/diff`, `CodeReview.vue`

## Problem

Tickets reach `review` after a build agent opens a PR. The project has a legacy automatic reviewer, but it is a one-shot model call against the PR patch only. It cannot verify that the change compiles or passes tests, cannot inspect surrounding code or planning documents, and posts its findings only as ticket messages. On approval it writes `status=done` directly, skipping the `human_approval` phase that the phase model defines.

Two current-state facts make a naive replacement unsafe:

- `HarnessTicketProcessor.markReview()` only calls `updateTicketStatus(ticketId, "review")`; `Ticket.updateStatus()` changes only `status`. Tickets created by `Ticket.create()` start at `phase='draft'`, so an agent-built ticket normally reaches `status=review` with a phase of `draft` or `in_progress`. `PhaseService` only allows `review -> human_approval`, so the proposed transition is rejected unless the phase is reconciled first.
- `PhaseService.PHASE_TO_STATUS` maps `human_approval` to `status=review`, and the legacy queue filters by `status` only. A ticket waiting for human approval is therefore still visible to the legacy reviewer, which then sets `status=done`.

The result is an automatic review that is hard to trust, easy to re-run accidentally, and disconnected from GitHub review and human approval.

## Current state (legacy)

| Area | Legacy behavior |
|---|---|
| Trigger | Polls tickets with `status=review` every poll interval (no phase filter) |
| Input | Ticket title + GitHub PR file patches |
| Reasoning | One-shot `AiProvider` call returning JSON |
| Output | Ticket `status`/`comment` messages |
| Verification | None |
| Approval | Sets `status=done` directly; phase is unchanged (typically `draft` or `in_progress`, not `review`) |
| Dedupe | None; rejected tickets are re-reviewed every cycle |
| GitHub | No PR review, no approve/request-changes API call |
| Deployment | Requires a second agent process running without `REPO_OWNER` |
| Tests | None |

## Goals

1. Run reviews in an OpenCode harness session with a **read-only tool policy** (`edit=deny`) inside a **writable, disposable workspace**, so verification installs/builds can run while the supervisor never publishes the reviewer's tree.
2. Give the reviewer repo context: ticket, planning docs, `AGENTS.md`, changed files, and surrounding code.
3. Let the **supervisor** execute verification commands and capture pass/fail plus bounded output; model-supplied verification is never trusted.
4. Produce a structured verdict and findings: `approve`, `request_changes`, or `comment`, with severity, file, line, message and suggestion.
5. In Phase 1, publish findings to the GitHub PR as a **COMMENT-only** review, and mirror the summary to the planner ticket. `APPROVE`/`REQUEST_CHANGES` require a distinct reviewer identity and are deferred.
6. Route approved reviews to `human_approval`, never directly to `done`; never merge. Phase reconciliation happens before the transition.
7. Make reviews idempotent per completed SHA, while allowing retries after a failed attempt.
8. Publish structured findings for fg-32. The **fixer, round limits and findings consumption are owned by fg-32**, not this ticket.
9. Keep the legacy reviewer available behind `REVIEW_HARNESS_MODE=legacy|opencode` until parity is proven.

## Non-goals

- Auto-merging PRs. Merging remains a human/reviewer decision unless a later explicit autonomy policy says otherwise.
- Replacing human approval. The reviewer is an additional gate, not the final gate.
- Reviewing arbitrary GitHub PRs that are not linked to a planner ticket (Phase 1 of this ticket).
- Implementing the fixer loop, round enforcement or findings consumption (owned by fg-32 / PR #104).
- Sending `APPROVE`/`REQUEST_CHANGES` without a distinct reviewer identity.
- Multi-agent fan-out or parallel reviewers (later).
- Changing the build harness from fg-30.

## Functional requirements

- **FR1 - Trigger:** review a ticket when it is in `status=review`, has a `pr_url`, and the current head SHA has no completed review. Phase is not part of the trigger: agent-built tickets normally arrive as `status=review` with `phase=draft|in_progress`, so FR6 reconciles the phase before the review starts.
- **FR2 - Context:** include ticket description, planning docs, repository instructions, PR metadata, changed files, and the diff.
- **FR3 - Verification (supervisor-owned):** the supervisor runs configured verification commands in the checked-out PR head and captures pass/fail plus bounded output. If no commands are configured or autodetected, verification fails closed (no approval).
- **FR4 - Structured output:** validate model JSON against a schema; reject malformed output instead of posting free text. The schema has no verification field; if the model emits one, it is ignored.
- **FR5 - GitHub review:** Phase 1 creates a PR review with `event=COMMENT` and a body summary, including a `commit_id` for the reviewed SHA. Inline comments only when the file/line is part of the diff. `APPROVE`/`REQUEST_CHANGES` are Phase 2, gated on a non-author identity.
- **FR6 - Phase reconciliation and routing:** reconcile before the review runs (the trigger is status-based). If `phase` is not `review`, call a reconcile endpoint (new) or rely on fg-30 lifecycle sync; if reconciliation fails, still post the COMMENT review but escalate to a human and do not attempt approval. Re-check `phase=review` immediately before approval. On success, `review -> human_approval`; `request_changes`/`comment` stay in `review`; never write `done`.
- **FR7 - Idempotency and retries:** store `reviewed_sha`, attempt status, `round`, `verdict`, timestamps and the GitHub review id. Only `completed` attempts block a re-review of the same SHA; `failed` or stale `started` attempts may be retried. Re-check the PR head before posting. Before posting, adopt an existing reviewer review for the same `commit_id` (covering a post-success/DB-failure retry) instead of posting a duplicate.
- **FR8 - Findings handoff:** fg-31 defines and writes `ticket_review_attempts` and `ticket_review_findings`; on `request_changes` it calls fg-32's `POST /tickets/:id/review/request-changes` with the attempt id. fg-32 consumes them and owns fix dispatch, rounds and findings consumption. fg-31 does not implement the fixer.
- **FR9 - Fallback:** if the harness, provider, GitHub API, or verification is unavailable, post a clear failure, leave the ticket in `review`, and never approve.
- **FR10 - Rollout:** `REVIEW_HARNESS_MODE` defaults to `legacy`; `opencode` enables the new path. Before the bake, legacy must run in shadow mode or be disabled.

## Safety requirements

- Reviewer tool policy is read-only for code edits: `edit=deny`. The workspace itself is writable and disposable because verification installs dependencies and builds; the supervisor never commits, pushes, merges or publishes the reviewer's tree.
- Reviewer cannot commit, push, merge, or create PRs; the supervisor owns git operations.
- Reviewer cannot read `.env*`, secrets, or paths outside the workspace.
- No provider key, GitHub token, or server password may appear in findings, logs, or posted messages.
- Malformed model output must fail closed (no approval).
- A review must never be recorded as approved when supervisor verification failed, timed out, or ran zero commands.
- Verification executes arbitrary PR code. Until a sandbox/egress-hardening ticket lands, verification must run with the fg-30 workspace limits and a disposable tree; do not run it with host credentials.
- Do not send `APPROVE`/`REQUEST_CHANGES` with the token that authored the PR. GitHub rejects self-review, so Phase 1 stays `COMMENT` only.

## Acceptance criteria

1. A ticket with `status=review` and a PR is reconciled to `phase=review`, reviewed by the harness, and receives a GitHub **COMMENT** review plus a planner summary.
2. The review includes the supervisor's verification commands and results; model-supplied verification is ignored.
3. Approval moves the ticket to `human_approval` only after phase reconciliation, never to `done`.
4. Re-running the reviewer for a completed SHA produces no duplicate review or additional provider spend; a failed attempt can be retried for the same SHA, including when the GitHub review posted but the attempt-completion write failed.
5. A moving PR head aborts or restarts the review instead of posting against the wrong SHA.
6. A ticket in `human_approval` is not returned to the legacy reviewer.
7. The legacy reviewer remains selectable when the flag is `legacy`, honors the `phase=review` filter, and its shadow mode suppresses status writes during the bake.
8. Unit/contract tests use a fake OpenCode server and a fake GitHub review API; no real network calls.
9. Secrets never appear in review output or error messages.

## Out of scope

- Auto-merge.
- Reviewing PRs without a planner ticket.
- Cross-repository reviews.
- Review analytics dashboards.
- Email/Slack notifications.
- Fixer execution and round enforcement (fg-32).
- `APPROVE`/`REQUEST_CHANGES` GitHub events until a distinct reviewer identity exists.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Human question loop (reviewer questions/fix decisions) | Agent / UX | `fg-30` Phase 2 | No |
| 2 | new | Email notifications for review results (no existing email-notification ticket; bp-71 is account lockout) | UX | TBD | No |
| 3 | bp-106 | Ship review events to log aggregation | Observability | TBD (new follow-up) | No |
| 4 | bp-04 | Review cost/budget dashboard | Observability / Billing | TBD (new follow-up) | No |
| 5 | fg-13 | Contract updates for new review endpoints | Testing | TBD (new follow-up) | No |
| 6 | bp-99-frontend-testing | E2E coverage for review UI | Testing | TBD (new follow-up) | No |

`From Ticket` records where the deferred improvement was found; `TBD` means no follow-up ticket exists yet, so this table does not imply one is already tracked.
