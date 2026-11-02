# 03_ARCHITECT_IMPLEMENTATION.md - Durable Harness Execution (fg-33)

**Status:** Slice 1 implemented
**Date:** 2026-11-02
**Depends on:** fg-30 Phase 1

## Slice 1 scope

Persist the harness run lifecycle and enforce a single active run per ticket.
Recovery, idempotent publish and workspace reaping build on this layer in
follow-up slices.

Delivered:

- `045_harness_runs.sql` creates `harness_runs`, `harness_checkpoints` and
  `harness_leases` (UUID primary keys, BIGINT FKs, indexes, checks).
- `HarnessRunService` owns all state transitions:
  - `startRun` before any Git/OpenCode side effect;
  - `recordCheckpoint` after clone, session, prompt, verification and publish
    (single CTE so a late checkpoint cannot resurrect a finished run);
  - `heartbeat` / `renewLease` for the owning agent;
  - `claimLease` atomically upserts only when no unexpired lease is held;
  - `finishRun` is idempotent and releases the lease in the same statement;
  - `reapExpiredLeases` uses `FOR UPDATE SKIP LOCKED`, fails the run and
    returns the ticket ids for the caller to release.
- `api/harnessRuns.js` exposes the agent-facing API under `/api/v1/harness`.
  Mutating routes require the owning agent's API key; operators can read runs
  and checkpoints with a JWT.
- `HarnessTicketProcessor` starts a run after pickup, claims the lease, records
  each checkpoint, renews the lease from a heartbeat thread and finishes the
  run on success or failure. Persistence is best-effort during rollout: a
  backend failure logs a warning and the harness continues without durability.

## Decisions

- **Leases live in Postgres** (open question 1). They are written in the same
  database as the run audit trail; Redis can be added later if contention
  requires it.
- **Heartbeat renews the lease.** `HARNESS_HEARTBEAT_SECONDS` (default 30) also
  drives `HARNESS_LEASE_SECONDS` (default 600), so a dead agent stops renewing
  and the reaper can take over.
- **Resume is not enabled yet.** `HARNESS_RESUME_MODE` remains unimplemented;
  runs are marked failed by the reaper and the ticket is returned for a clean
  retry.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `HARNESS_LEASE_SECONDS` | `600` | Lease claim/renew TTL |
| `HARNESS_HEARTBEAT_SECONDS` | `30` | Heartbeat + lease renewal interval |
| `HARNESS_MAX_ATTEMPTS` | `3` | Existing retry backoff (unchanged) |

## Tests

- `backend/src/__tests__/harnessRunService.test.js` covers validation, run
  lifecycle, checkpoint CTE, idempotent finish, lease claim/renew/release and
  reaper SQL.
- `backend/src/__tests__/api-harness-runs.test.js` covers agent auth, run
  ownership, checkpoints, heartbeats, finish and lease conflicts.
- `HarnessTicketProcessorTest` verifies the agent persists a run, claims the
  lease, records every checkpoint, finishes on success/failure and refuses to
  clone when another run holds the lease.

## Remaining for fg-33

1. Agent startup recovery (`AgentApp`) using `listActiveRunsForAgent`.
2. Resume/restart policy per checkpoint (`HARNESS_RESUME_MODE`).
3. Scheduled reaper wiring + ticket release through `TicketService`.
4. Idempotent publish: branch/PR detection and `head_sha`/`pr_url` storage.
5. Workspace registry/retention cleanup.
6. Crash-injection tests, metrics, alerts and manual recovery runbook.
