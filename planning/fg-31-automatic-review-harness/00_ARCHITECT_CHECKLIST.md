# 00_ARCHITECT_CHECKLIST.md - Automatic Review Harness (fg-31)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Revised:** 2026-11-01 (addresses PR #103 design review)
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor), fg-30 Phase 2 (durable human loop), fg-32 (#104) for fix dispatch/rounds/findings consumption
**Related legacy path:** `agent/src/main/java/com/vibecode/agent/service/ReviewProcessor.java`

## Why this ticket exists

The project already has an automatic review path, but it is the legacy one-shot reviewer:

- it only sees the GitHub PR patch, not the repository, tests, or planning documents;
- it posts findings as planner ticket messages, not GitHub PR reviews;
- it approves by setting `status=done` directly, bypassing the `human_approval` phase;
- its review queue filters on `status=review` only, and `human_approval` also maps to `status=review`, so it can bypass the human gate;
- it has no reviewed-SHA marker, so a rejected ticket is re-reviewed every poll cycle;
- it cannot run verification commands.

This ticket records the missing reviewer harness. It is **not** part of fg-30 Phase 1.

## Phase 1 decisions (resolved review blockers)

| # | Review concern | Phase 1 decision |
|---|---|---|
| 1 | GitHub forbids self-approval (PR author == token owner) | **COMMENT-only reviews in Phase 1.** Do not send `APPROVE` or `REQUEST_CHANGES`; the planner phase gate is the decision. A distinct reviewer identity (GitHub App installation token) is a Phase 2 follow-up and is not present in this repository. |
| 2 | Tickets reach `status=review` with `phase=draft/in_progress`; `review -> human_approval` is then rejected | **Phase reconciliation is a hard prerequisite.** The reviewer triggers on `status=review`, reconciles the phase before checkout, and re-checks it before approval (or relies on fg-30 lifecycle sync). If reconciliation is unavailable, the run stays COMMENT-only and escalates to a human. |
| 3 | Legacy reviewer can still claim `human_approval` tickets and set `done` | **Filter the legacy queue by `phase=review`**, and run legacy in shadow mode (no status writes) or disabled before the bake. |
| 4 | `verification` inside model JSON lets the model approve a failing PR | **Verification is supervisor-owned.** Remove verification from the model schema; the parser ignores model-supplied results. Zero verification commands fails closed. |
| 5 | A read-only mount cannot run `npm ci` / builds | **Writable disposable workspace.** The model still gets `edit=deny`; the supervisor never publishes the reviewer tree and destroys the workspace after the run. |
| 6 | Scope/table overlap with fg-32 (#104) | **fg-31 owns the reviewer, `ticket_review_attempts` and `ticket_review_findings` writes. fg-32 owns fix dispatch, round limits and findings consumption.** |
| 7 | `UNIQUE(ticket_id, sha)` prevents retrying transient failures | **Attempt status (`started/completed/failed`).** Only `completed` reviews are idempotent; `failed`/stale `started` attempts may be retried. |
| 8 | Zero verification commands is vacuously "passing" | **Zero commands fails closed**, matching fg-30: empty means autodetect, then reject the approval if nothing runs. |
| 9 | Round semantics ambiguous (`max 2 rounds`, `round 3 escalates`) | **Owned by fg-32.** Initial review is round 0; each accepted `request_changes` increments; "max 2 rounds" means 2 fix rounds after the initial review (3 reviews total). fg-31 only stores the round it receives. |

## Checklist

- [ ] Merge fg-30 Phase 1 (PR #102) and validate one real ticket end-to-end
- [ ] Land fg-30 lifecycle sync (`status=review` implies `phase=review`) **or** add `POST /tickets/:id/phases/reconcile`
- [ ] Decide Phase 1 review event (`COMMENT` only) and document the Phase 2 reviewer identity follow-up
- [ ] Add `phase` filtering to the ticket list API and the legacy `listReviewTickets()`
- [ ] Run legacy in shadow mode (no status writes) or disable it during the bake
- [ ] Define the structured review schema and verdict mapping (no model-supplied verification)
- [ ] Define the disposable writable workspace and confirm the supervisor never publishes it
- [ ] Align review tables with fg-32: `ticket_review_attempts` + `ticket_review_findings`
- [ ] Add attempt status and a partial unique index for completed reviews
- [ ] Define partial-publish recovery (persisted review id + `commit_id`/marker dedupe before posting)
- [ ] Decide rollout flag (`REVIEW_HARNESS_MODE=legacy|opencode`)
- [ ] Write `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] Write `04_SPECIFICATION.md` for reviewer Phase 1
- [ ] Implement behind the rollout flag
- [ ] Add contract tests with a fake OpenCode server and a fake GitHub review API
- [ ] Dogfood on a real PR, comparing legacy (shadow) and harness reviews
- [ ] Deprecate the legacy `ReviewProcessor` only after parity and a human-approval gate
