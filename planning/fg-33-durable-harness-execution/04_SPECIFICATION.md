# 04_SPECIFICATION.md - Durable Harness Execution, slice 2 (fg-33)

**Status:** Implemented
**Date:** 2026-11-02
**Branch:** `feat/fg-33-slice-2-recovery-and-reaper` (stacked on slice 1)
**Depends on:** slice 1 (`045_harness_runs.sql`, `HarnessRunService`,
`HarnessTicketProcessor`)

## Milestone goal

Make an interrupted run self-healing without ever undoing published work.

## In scope

1. Scheduled reaper in the API process.
2. Guarded ticket release from recovery and reaping.
3. Agent startup recovery for that agent's active runs.
4. `HARNESS_RESUME_MODE=restart|resume` with published-work adoption.
5. Durable publish evidence before the terminal finish.
6. Automated coverage for every new path, including restart and lost-finish
   sequences.

## Acceptance criteria

- A sweep of an expired lease fails the run and returns the ticket only when the
  ticket is `in_progress`, has no `pr_url`, and no newer run is active.
- A reviewed ticket or a ticket with a PR is never returned to backlog by
  recovery or reaping.
- At startup, an agent lists only its own active runs and reconciles each one.
- A run with a stored PR URL finishes `succeeded`; the ticket keeps its PR and
  review status.
- With `HARNESS_RESUME_MODE=resume`, a `publishing`/`done` run with a stored
  head sha is adopted when the branch already has a PR.
- A run whose finish cannot be confirmed after retries is left for the reaper;
  no ticket is released.
- Publish evidence is written before `finish`, so a lost finish response is
  recoverable.

## Test matrix

| Layer | File | Coverage |
|---|---|---|
| Service unit | `backend/src/__tests__/harnessRunService.test.js` | recovery query, publish evidence, guarded release SQL |
| Reaper unit | `backend/src/__tests__/harnessReaper.test.js` | `run_failed` filter, refusal, per-row isolation |
| Route unit | `backend/src/__tests__/api-harness-runs.test.js` | agent-scoped list, publish, release-ticket auth |
| Postgres integration | `backend/src/__tests__/integration/harnessRuns.test.js` | publish evidence, checkpoint join, in-progress vs reviewed release, newer-run guard |
| Agent processor | `agent/src/test/java/.../HarnessTicketProcessorTest.java` | restart release, publish adoption, resume PR lookup, unconfirmed finish |
| Agent HTTP | `agent/src/test/java/.../ApiServiceHarnessTest.java` | recovery list path, publish body, guarded release boolean |
| Config | `agent/src/test/java/.../HarnessConfigTest.java` | `HARNESS_RESUME_MODE` parsing/validation |

## Out of scope (next milestone)

- Workspace registry, retention and orphan cleanup.
- Crash-injection process-kill tests in CI, metrics and alerts.
- Dead-letter/adoption operator flow.
- Resuming a live OpenCode session (only published work is adopted).

## Pending Scope Items to Present to User

- Slice 3: workspace retention plus operator dead-letter/adoption flow.
- fg-41: structured harness events, metrics and dashboards for stuck runs.
- fg-44: storage lifecycle (idle refresh, disk/inode watermarks).
