# 03_ARCHITECT_IMPLEMENTATION.md - Durable Harness Execution (fg-33)

**Status:** Slices 1-3 implemented (merged into the feature branch via PR #112; PR #110 carries the combined diff to master)
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
  - `startRun` only inserts when the ticket is `in_progress`, has no `pr_url`,
    has no prior run with PR/head-sha evidence, and `assigned_agent_id` matches
    the agent owner; it maps the active-run unique index to `409 Conflict`.
    These checks close the recovery window where a published backlog ticket
    could otherwise be started again.
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
  Mutating routes require the owning agent's API key. JWT reads require an
  operator role (`super_admin`, `project_admin`, `member`) **and**
  `AGENT_READ`, and are scoped to the ticket's project (project owner or
  member). The `user` role is denied explicitly even though the permission
  seed grants it `AGENT_READ`.
- `HarnessTicketProcessor` starts a run after pickup, claims the lease, records
  each checkpoint, renews the lease from a heartbeat thread and finishes the
  run on success or failure.
  - Start 4xx decisions (`CONFLICT`, `FORBIDDEN`, `VALIDATION_ERROR`,
    `UNAUTHORIZED`, `KEY_EXPIRED`) are fatal even without
    `HARNESS_DURABILITY_REQUIRED`; only network/5xx/404 failures stay
    best-effort during rollout.
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
    terminal with a different status.
  - The intended terminal status is recorded (`succeeded`, or `failed` with a
    release flag). The finally block retries the *same* status. A successful
    publish is never downgraded to failed and never releases a reviewed ticket;
    a lease-loss failure is retried but never releases; an ordinary failure is
    released with the existing backoff only after the retry confirms the run
    terminal. If confirmation still fails, the ticket stays assigned for
    recovery.
  - `HARNESS_DURABILITY_REQUIRED=true` makes the initial run creation fail
    closed too. It defaults to `false` for rollout.

## Slice 2 scope

Recovery and safe reaping on top of the slice 1 lifecycle:

- **Scheduled reaper.** `HarnessReaper` runs from the API process every
  `HARNESS_REAPER_INTERVAL_SECONDS` (default 60, `0` disables). Each sweep calls
  `reapExpiredLeases`, then reconciles every reaped run plus any terminal run
  whose `reconciled_at` marker is still unset.
- **Guarded ticket release.** `HarnessRunService.releaseTicketForRun` is the only
  recovery path that returns a ticket to backlog. It requires a terminal
  (`failed`/`dead_letter`) run **with no run-level PR or head sha**, the ticket
  still `in_progress`, no ticket PR, no other run for the ticket with PR/head
  evidence, and no newer active run. A pushed branch (`head_sha` without a PR)
  is treated as publish evidence and reported as `needs_operator` instead of
  being silently re-run.
- **Terminal-run reconciliation.** `046_harness_run_reconciliation.sql` adds a
  `reconciled_at` marker, a partial index for pending terminal runs, a one-time
  backfill for historical terminal runs and empty-string normalisation.
  `reconcileRun` only changes the ticket when it flips `reconciled_at` from
  NULL, so repeated/concurrent calls cannot re-apply old state. It reconciles
  the **latest run per ticket**: older runs are marked superseded and promoted
  to succeeded if they recorded a PR, but never release a ticket for a newer
  run or overwrite a newer ticket PR. A published run fills a missing ticket
  PR (never overwrites a different one) and moves `in_progress`/`backlog` to
  `review`; done tickets are never changed. `reapExpiredLeases` marks a run
  `succeeded` when it already has a PR URL, and a sweep of the newest pending
  terminal run per ticket recovers the crash gap between reaping and releasing.
- **Agent startup recovery.** `HarnessTicketProcessor.recoverActiveRuns()` lists
  this agent's active runs at startup (with the latest checkpoint payload). It
  adopts a run that has durable publish evidence (PR URL, or head sha plus an
  existing PR) as `succeeded`, restores the ticket PR URL/review state, and
  never releases it. It then calls the agent-scoped reconcile route so a
  backlog ticket moves to review synchronously, before the poll loop can claim
  it. Other runs are failed and released through the guarded path; if the
  finish cannot be confirmed the run is left for terminal-run reconciliation.
- **Durable publish evidence.** `POST /harness/runs/:runId/publish` stores
  `head_sha` immediately after the push and `pr_url` immediately after PR
  creation, before the terminal finish. `recordCheckpoint` also copies
  `headSha`/`prUrl` from checkpoint payloads, so a lost publish call followed by
  a `done` checkpoint still leaves run-level evidence. `047` backfills existing
  checkpoint-only evidence per field (head sha and PR URL may come from
  different checkpoints) and clears `reconciled_at` so the sweep re-evaluates
  it.
- **Resume policy.** `HARNESS_RESUME_MODE=restart` (default) always fails and
  requeues interrupted runs. `resume` additionally tries to adopt a run whose
  last checkpoint is `publishing`/`done` and whose head sha has an existing PR.
  In-memory OpenCode sessions are still restarted from a clean clone; resume
  preserves published work, not a live prompt session.
- New agent-scoped routes: `GET /harness/agents/:agentId/runs`,
  `POST /harness/runs/:runId/publish`,
  `POST /harness/runs/:runId/reconcile`,
  `POST /harness/runs/:runId/release-ticket`.

## Slice 3 scope

Operator recovery, cleanup and observability:

- **Operator actions.** `POST /harness/runs/:runId/dead-letter` stops a stuck run,
  deletes its lease, clears `reconciled_at` and hands the ticket to the normal
  reconciliation guards. A succeeded run without PR/head evidence can be
  dead-lettered; one with evidence is refused. `POST /harness/runs/:runId/adopt`
  accepts an operator-verified `prUrl` only when the run has no PR URL; a
  different existing run PR is never overwritten. It re-runs the latest-run/
  ticket guards and can re-adopt a run marked reconciled without adopting. Both
  require an operator JWT with `TICKET_UPDATE` and project access; agent keys
  and the `user` role are refused.
- **Workspace retention.** `HARNESS_WORKSPACE_RETENTION_HOURS` (default 24, `0`
  disables) prunes stale clone directories only after startup recovery lists
  active runs successfully. It fetches protected paths from
  `GET /harness/agents/:agentId/workspaces` (running runs or unexpired leases)
  and fails closed if that list is unavailable or if an active run has no
  recorded workspace path. Only generated workspace names
  are considered; symlinks, non-directories, fresh directories and the current
  workspace are skipped. Crash-left `opencode-harness-*` and
  `vibecode-askpass-*` temp dirs are pruned with the same retention.
  Deployment assumption: one agent identity per clone root and temp namespace;
  protected paths are agent-scoped while temp cleanup is global. Cleanup is
  startup-only today; scheduled pruning remains a fg-44/fg-33 follow-up.
- **Metrics.** `HarnessMetrics` exports reaped/reconciled/released/adopted/
  needs-operator counters, `harness_reaper_sweep_failures_total`, and
  `harness_reaper_last_success_timestamp_seconds`. The success timestamp only
  advances for a complete sweep; listing/reconcile failures keep it stale.
- **Runbook.** `05_RUNBOOK.md` documents inspection SQL, adoption, dead-letter,
  manual sweeps, retention and crash scenarios.

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
- **Resume preserves published work only.** `HARNESS_RESUME_MODE=resume`
  adopts a run once a head sha/PR exists; OpenCode sessions and uncommitted
  workspaces cannot be resumed across a process restart, so every other run
  restarts from a clean clone. `restart` is the default because it has no
  adoption ambiguity.
- **One active run per ticket is enforced** by the partial unique index plus
  the lease, and orphaned runs are reaped by heartbeat age.
- **The reaper is scheduled by the API process.** It is safe to run from
  multiple instances: `FOR UPDATE SKIP LOCKED` elects one sweeper per row and
  release is guarded and idempotent. Set the interval to `0` only when
  operating with a separate external cron.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `HARNESS_LEASE_SECONDS` | `600` | Lease claim/renew TTL (clamped 60–86400) |
| `HARNESS_HEARTBEAT_SECONDS` | `30` | Heartbeat + lease renewal interval (≤ lease/2) |
| `HARNESS_DURABILITY_REQUIRED` | `false` | Fail closed when the initial run cannot be persisted |
| `HARNESS_MAX_ATTEMPTS` | `3` | Existing retry backoff (attempt persisted on the run) |
| `HARNESS_RESUME_MODE` | `restart` | Startup recovery: `restart` or `resume` (adopt published evidence) |
| `HARNESS_REAPER_INTERVAL_SECONDS` | `60` | Scheduled reaper sweep interval; `0` disables it |
| `HARNESS_WORKSPACE_RETENTION_HOURS` | `24` | Agent startup cleanup of stale clone dirs; `0` disables |

## Tests

- `backend/src/__tests__/harnessRunService.test.js` covers validation,
  authorization, run lifecycle, checkpoint ordering, idempotent finish, lease
  claim/renew/release and reaper SQL.
- `backend/src/__tests__/api-harness-runs.test.js` covers agent auth, run
  ownership, JWT permission/project scoping, checkpoints, heartbeats, finish
  and lease conflicts.
- `backend/src/__tests__/integration/harnessRuns.test.js` executes against
  PostgreSQL (45 tests): assignment authorization, sequential and concurrent
  one-active-run races, unexpired lease blocking, expired-lease reaping, orphan
  reaping, idempotent finish + lease release, checkpoint ordering/context,
  publish evidence, guarded reaping/reconciliation (reaped published runs,
  interrupted releases, old-vs-new multi-run ordering, existing ticket PRs,
  backlog adoption, one-time reconciliation), wrong-agent lease claims and
  renewal after release/terminal runs.
- `HarnessTicketProcessorTest` verifies run persistence, lease claim failure,
  lease-loss publishing refusal, transient heartbeat retry, finish retry and
  all checkpoints.
- `harnessReaper.test.js` covers guarded release, `run_failed=false` skips,
  release refusals and per-row failure isolation.
- `HarnessTicketProcessorTest` also covers startup recovery: interrupted runs
  fail and release, published runs are adopted without release, `resume` finds
  an existing PR from publish evidence, and an unconfirmed finish leaves the run
  for the reaper.
- `ApiServiceHarnessTest` exercises the real HTTP client against a local
  `HttpServer`: start/checkpoint/heartbeat/finish/lease/publish/recovery paths,
  auth header, request bodies, 401 fatal classification and 409-vs-transient
  lease errors.
- The Postgres integration suite also verifies publish evidence (including
  checkpoint-only evidence), the latest checkpoint join, run-level PR release
  guards, reaped-published adoption, terminal-run reconciliation by the reaper,
  operator dead-letter/adoption, and that an old failed run cannot release a
  ticket owned by a newer active run.
- `WorkspaceManagerTest` covers stale/fresh dirs, foreign names, protected and
  current workspaces, symlinks, unreadable protected paths, zero retention and
  crash-left temp dirs.

## Remaining for fg-33

1. A CI process-kill/e2e matrix (the current tests simulate crash gaps at the
   service/processor level).
2. Live OpenCode session resume; only published work is adopted today.
