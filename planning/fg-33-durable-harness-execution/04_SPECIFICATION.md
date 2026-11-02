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
6. A `reconciled_at` marker, one-time backfill and latest-run terminal sweep so
   a crash between reaping and releasing cannot strand a ticket and old runs
   cannot regress newer work.
7. Automated coverage for every new path, including restart and lost-finish
   sequences.

## Acceptance criteria

- A sweep of an expired lease finishes the run and returns the ticket only when
  the run recorded no PR or head sha, no other run for the ticket has publish
  evidence, the ticket is `in_progress`, has no `pr_url`, and no newer run is
  active. A run with a stored PR is marked `succeeded` and adopted.
- A reviewed ticket or a ticket with a PR is never returned to backlog by
  recovery or reaping.
- A latest run with head-sha-only or no-PR success evidence leaves the ticket
  in `in_progress` and is reported as `needs_operator` rather than released.
- At startup, an agent lists only its own active runs, reconciles each one and
  asks the backend to reconcile terminal runs synchronously, so a published
  backlog ticket cannot be polled again.
- A backlog ticket with a PR URL is not eligible for polling, and `startRun`
  refuses it (or a ticket whose earlier run has PR/head evidence) even if it is
  polled by an older agent.
- A run with a stored PR URL finishes `succeeded`; the ticket keeps its PR and
  review status. An existing, different ticket PR is never overwritten.
- Only the latest run per ticket can change the ticket; older runs are marked
  superseded without releasing or adopting.
- Reconciliation runs once per run (`reconciled_at` gate), so repeated or
  concurrent sweeps cannot re-apply old state.
- A published run moves an in_progress or backlog ticket to review; done is
  never regressed.
- A failed run with a PR is promoted to `succeeded`, and a failed run with a
  head sha but no PR is not released.
- With `HARNESS_RESUME_MODE=resume`, a `publishing`/`done` run with a stored
  head sha is adopted when the branch already has a PR.
- A run whose finish cannot be confirmed after retries is left for the
  terminal-run reconciliation sweep. Release only happens there after the run
  is terminal and the ticket/PR/run guards pass.
- Publish evidence is written before `finish`, so a lost finish response is
  recoverable.

## Test matrix

| Layer | File | Coverage |
|---|---|---|
| Service unit | `backend/src/__tests__/harnessRunService.test.js` | recovery query, publish evidence, guarded release SQL, empty-string normalisation |
| Reaper unit | `backend/src/__tests__/harnessReaper.test.js` | terminal sweep, adoption vs release, dedupe, per-row retry |
| Reaper schedule unit | `backend/src/__tests__/harnessReaperSchedule.test.js` | default/zero/invalid/clamped intervals |
| Route unit | `backend/src/__tests__/api-harness-runs.test.js` | agent-scoped list, publish, reconcile, release-ticket auth |
| GitHub unit | `agent/src/test/java/.../GitHubServiceTest.java` | recovery PR lookup uses `state=open` |
| Postgres integration | `backend/src/__tests__/integration/harnessRuns.test.js` | publish evidence, checkpoint join, run-level PR/head-sha release guards, reaped-published adoption, interrupted release, multi-run ordering, existing ticket PR, backlog adoption, one-time reconciliation, newer-run guard |
| Agent processor | `agent/src/test/java/.../HarnessTicketProcessorTest.java` | restart release, publish adoption, synchronous reconcile, stale-ticket PR rejection, terminal mismatch, unconfirmed finish, post-publish no-release |
| Agent ticket model | `agent/src/test/java/.../TicketTest.java` | backlog ticket with a PR is not pollable |
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
