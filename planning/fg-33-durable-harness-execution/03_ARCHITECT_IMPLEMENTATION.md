# 03_ARCHITECT_IMPLEMENTATION.md - Durable Harness Execution (fg-33)

**Status:** Slice 1 implemented
**Date:** 2026-11-02
**Depends on:** fg-30 Phase 1

## Slice 1 scope

Persist the harness run lifecycle, enforce one active run per ticket and make
publishing fail closed when the lease is lost. Recovery, resume and idempotent
publish build on this layer in follow-up slices.

Delivered:

- `045_harness_runs.sql` creates `harness_runs`, `harness_checkpoints` and
  `harness_leases` (UUID primary keys, BIGINT FKs, indexes, checks).
  - A partial unique index (`ticket_id WHERE status='running'`) is the
    database backstop: a crashed start/claim pair cannot create a second live
    run for a ticket.
  - `agent_step` is separate from `step`; heartbeats never move the checkpoint
    state machine.
- `HarnessRunService` owns all state transitions:
  - `startRun` only inserts when the ticket is `in_progress` and
    `assigned_agent_id` matches the agent owner; it maps the active-run unique
    index to `409 Conflict`.
  - `recordCheckpoint` validates the step vocabulary (`created`, `cloned`,
    `session_ready`, `prompting`, `verifying`, `publishing`, `done`) and rejects
    backwards transitions in the same CTE. Cloned/session checkpoints also fill
    `workspace_path`, `session_id` and `base_sha`.
  - `heartbeat` updates `heartbeat_at` and `agent_step` only.
  - `claimLease` atomically upserts only when no unexpired lease is held, the
    run is active and the ticket is still assigned to the agent owner.
  - `finishRun` is idempotent and releases the lease in the same statement.
  - `reapExpiredLeases` uses `FOR UPDATE SKIP LOCKED`, fails expired-lease runs
    and also fails running runs with no lease whose heartbeat is stale
    (`orphanAfterSeconds`, default 900). It returns `run_failed` so callers
    only release tickets whose run this call actually failed.
- `api/harnessRuns.js` exposes the agent-facing API under `/api/v1/harness`.
  Mutating routes require the owning agent's API key. JWT reads require the
  `AGENT_READ` permission (granted to member/project_admin; the `user` role is
  denied) and are scoped to the ticket's project (project owner or member);
  `super_admin` may read all.
- `HarnessTicketProcessor` starts a run after pickup, claims the lease, records
  each checkpoint, renews the lease from a heartbeat thread and finishes the
  run on success or failure.
  - Start 4xx decisions (`CONFLICT`, `FORBIDDEN`, `VALIDATION_ERROR`) are
    fatal even without `HARNESS_DURABILITY_REQUIRED`; only network/5xx/404
    failures stay best-effort during rollout.
  - After a run exists, lease/auth failures fail closed: the heartbeat sets
    `leaseLost`, checkpoints/heartbeats that return `NOT_FOUND`/`CONFLICT` set
    it too, and publishing performs a synchronous lease renewal immediately
    before staging, commit/push and the PR. Lost leases leave the ticket for
    the reaper instead of releasing it and risking a concurrent publish.
    When the initial start was best-effort and no run/lease exists, this check
    cannot run and publishing is explicitly best-effort.
  - Transient heartbeat errors keep retrying; only an explicit lease loss
    stops publishing.
  - `finishDurableRun` retries with bounded backoff, clears the run id only
    after the backend confirms, and logs a mismatch if the run was already
    terminal with a different status. `failAndRelease` only returns the ticket
    to backlog after finish succeeds; otherwise it leaves the ticket assigned
    and posts a recovery message. The finally block retries the finish and
    releases only if that retry makes the run terminal.
  - `HARNESS_DURABILITY_REQUIRED=true` makes the initial run creation fail
    closed too. It defaults to `false` for rollout.

## Decisions

- **Leases live in Postgres** (open question 1). They share the run audit trail;
  Redis can be added later if contention requires it.
- **Heartbeat renews the lease.** `HARNESS_HEARTBEAT_SECONDS` (default 30) is
  clamped to at most half of `HARNESS_LEASE_SECONDS` (default 600, clamped to
  60–86400) so renewal always pre-empts expiry.
- **Step = last checkpointed phase.** `cloned`, `session_ready`, `prompting`
  and `verifying` are written after those steps complete; `publishing` is
  written immediately before the publish attempt and `done` after the PR.
  Steps cannot move backwards, and heartbeats carry only `agent_step`.
- **Resume is not enabled yet.** `HARNESS_RESUME_MODE` remains unimplemented;
  the reaper fails stale runs and the ticket is returned for a clean retry once
  the reaper caller releases it.
- **One active run per ticket is enforced** by the partial unique index plus
  the lease, and orphaned runs are reaped by heartbeat age.
- **Liveness dependency:** the reaper is implemented but not scheduled yet.
  Until slice 2 wires it, a stuck run/unique-index conflict needs the reaper
  endpoint/manual recovery before the ticket can run again.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `HARNESS_LEASE_SECONDS` | `600` | Lease claim/renew TTL (clamped 60–86400) |
| `HARNESS_HEARTBEAT_SECONDS` | `30` | Heartbeat + lease renewal interval (≤ lease/2) |
| `HARNESS_DURABILITY_REQUIRED` | `false` | Fail closed when the initial run cannot be persisted |
| `HARNESS_MAX_ATTEMPTS` | `3` | Existing retry backoff (attempt persisted on the run) |

## Tests

- `backend/src/__tests__/harnessRunService.test.js` covers validation,
  authorization, run lifecycle, checkpoint ordering, idempotent finish, lease
  claim/renew/release and reaper SQL.
- `backend/src/__tests__/api-harness-runs.test.js` covers agent auth, run
  ownership, JWT permission/project scoping, checkpoints, heartbeats, finish
  and lease conflicts.
- `backend/src/__tests__/integration/harnessRuns.test.js` executes against
  PostgreSQL (11 tests): assignment authorization, sequential and concurrent
  one-active-run races, unexpired lease blocking, expired-lease reaping, orphan
  reaping, idempotent finish + lease release, checkpoint ordering/context,
  wrong-agent lease claims and renewal after release/terminal runs.
- `HarnessTicketProcessorTest` verifies run persistence, lease claim failure,
  lease-loss publishing refusal, transient heartbeat retry, finish retry and
  all checkpoints.

## Remaining for fg-33

1. Agent startup recovery (`AgentApp`) using `listActiveRunsForAgent`.
2. Resume/restart policy per checkpoint (`HARNESS_RESUME_MODE`).
3. Scheduled reaper wiring + ticket release for rows where `run_failed=true`.
4. Idempotent publish: branch/PR detection and `head_sha`/`pr_url` storage.
5. Workspace registry/retention cleanup.
6. Crash-injection tests, metrics, alerts and manual recovery runbook.
7. Dead-letter/adoption flow for operators.
