# 01_ARCHITECT_REQUIREMENT.md - Automatic Review Harness (fg-31)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor), fg-30 Phase 2 (human question loop)
**Related code:** legacy `ReviewProcessor`, `GET /tickets/:id/review/diff`, `CodeReview.vue`

## Problem

Tickets reach `review` after a build agent opens a PR. The project has a legacy automatic reviewer, but it is a one-shot model call against the PR patch only. It cannot verify that the change compiles or passes tests, cannot inspect surrounding code or planning documents, and posts its findings only as ticket messages. On approval it writes `status=done` directly, skipping the `human_approval` phase that the phase model defines.

The result is an automatic review that is hard to trust, easy to re-run accidentally, and disconnected from GitHub review and human approval.

## Current state (legacy)

| Area | Legacy behavior |
|---|---|
| Trigger | Polls tickets with `status=review` every poll interval |
| Input | Ticket title + GitHub PR file patches |
| Reasoning | One-shot `AiProvider` call returning JSON |
| Output | Ticket `status`/`comment` messages |
| Verification | None |
| Approval | Sets `status=done` directly; phase stays `review` |
| Dedupe | None; rejected tickets are re-reviewed every cycle |
| GitHub | No PR review, no approve/request-changes API call |
| Deployment | Requires a second agent process running without `REPO_OWNER` |
| Tests | None |

## Goals

1. Run reviews in a **read-only** OpenCode harness session against the PR head, in an isolated workspace.
2. Give the reviewer repo context: ticket, planning docs, `AGENTS.md`, changed files, and surrounding code.
3. Let the reviewer (or its supervisor) execute verification commands and report what was actually run.
4. Produce a structured verdict and findings: `approve`, `request_changes`, or `comment`, with severity, file, line, message and suggestion.
5. Publish findings to the GitHub PR as a review, and mirror the summary to the planner ticket.
6. Route approved reviews to `human_approval`, never directly to `done`; never merge.
7. Make reviews idempotent per SHA: record the reviewed commit and avoid duplicate reviews/spend.
8. Support a bounded fixer loop: findings become build input, the fixer pushes a new commit, and the reviewer re-reviews the new SHA (max 2 rounds initially).
9. Keep the legacy reviewer available behind `REVIEW_HARNESS_MODE=legacy|opencode` until parity is proven.

## Non-goals

- Auto-merging PRs. Merging remains a human/reviewer decision unless a later explicit autonomy policy says otherwise.
- Replacing human approval. The reviewer is an additional gate, not the final gate.
- Reviewing arbitrary GitHub PRs that are not linked to a planner ticket (Phase 1 of this ticket).
- Multi-agent fan-out or parallel reviewers (later).
- Changing the build harness from fg-30.

## Functional requirements

- **FR1 - Trigger:** review a ticket when it enters `review` and has a `pr_url`, or when a new SHA is pushed to an existing review branch.
- **FR2 - Context:** include ticket description, planning docs, repository instructions, PR metadata, changed files, and the diff.
- **FR3 - Verification:** run configured verification commands in the checked-out PR head and capture pass/fail plus bounded output.
- **FR4 - Structured output:** validate a JSON review against a schema; reject malformed output instead of posting free text.
- **FR5 - GitHub review:** create a PR review with `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`, including inline findings where the file/line is valid.
- **FR6 - Phase routing:** `approve` -> `review` to `human_approval`; `request_changes` -> keep `review` (or return to `in_progress` for the fixer); never write `done`.
- **FR7 - Idempotency:** store `reviewed_sha`, `round`, `verdict`, and timestamp; skip a SHA that was already reviewed.
- **FR8 - Fixer loop:** on `request_changes`, publish findings to the build path, allow one fix commit per round, and re-review the new SHA; stop after the configured round limit and escalate to a human.
- **FR9 - Fallback:** if the harness, provider, GitHub API, or verification is unavailable, post a clear failure, release/keep the ticket in `review`, and never approve.
- **FR10 - Rollout:** `REVIEW_HARNESS_MODE` defaults to `legacy`; `opencode` enables the new path.

## Safety requirements

- Reviewer workspace is **read-only** for code edits: `edit=deny`, writes denied; verification commands are the only execution allowed.
- Reviewer cannot commit, push, merge, or create PRs; the supervisor owns git operations.
- Reviewer cannot read `.env*`, secrets, or paths outside the workspace.
- No provider key, GitHub token, or server password may appear in findings, logs, or posted messages.
- Malformed model output must fail closed (no approval).
- A review must never be recorded as approved when verification failed or timed out.

## Acceptance criteria

1. A ticket in `review` with a PR is reviewed by the harness and receives a GitHub PR review plus a planner summary.
2. The review includes the list of verification commands and their results.
3. Approval moves the ticket to `human_approval`, not `done`.
4. Re-running the reviewer for the same SHA produces no duplicate review or additional provider spend.
5. A rejected review can drive one fix commit and one re-review; round 3 escalates to a human.
6. The legacy reviewer remains selectable and unchanged when the flag is `legacy`.
7. Unit/contract tests use a fake OpenCode server and a fake GitHub review API; no real network calls.
8. Secrets never appear in review output or error messages.

## Out of scope

- Auto-merge.
- Reviewing PRs without a planner ticket.
- Cross-repository reviews.
- Review analytics dashboards.
- Email/Slack notifications.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Human question loop (reviewer questions/fix decisions) | Agent / UX | `fg-30` Phase 2 | No |
| 2 | bp-71 | Email notifications for review results | UX | `bp-71-email-notifications` | No |
| 3 | bp-106 | Ship review events to log aggregation | Observability | `bp-106-harness-event-shipping` | No |
| 4 | bp-04 | Review cost/budget dashboard | Observability / Billing | `bp-04-harness-budgets` | No |
| 5 | fg-13 | Contract updates for new review endpoints | Testing | `fg-13-contract-followup` | No |
| 6 | bp-99 | E2E coverage for review UI | Testing | `bp-99-e2e-harness-ui` | No |
