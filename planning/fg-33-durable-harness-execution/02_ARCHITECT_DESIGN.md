# 02_ARCHITECT_DESIGN.md - Durable Harness Execution (fg-33)

## Design summary

Persist the run as a state machine, make every side effect idempotent, and use a lease plus heartbeat to detect death. Recovery is a first-class agent startup path, not an afterthought.

```
CREATE -> CLONED -> SESSION_READY -> PROMPTING -> VERIFYING -> PUBLISHING -> DONE
   |         |            |              |            |            |
   +---------+------------+--------------+------------+------------+--> FAILED
```

Each state transition writes a checkpoint. Steps that touch Git or GitHub carry an idempotency key.

## Data model

```sql
CREATE TABLE harness_runs (
  id UUID PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  base_sha TEXT,
  head_sha TEXT,
  workspace_path TEXT,
  session_id TEXT,
  provider TEXT,
  model TEXT,
  step TEXT NOT NULL,
  status TEXT NOT NULL, -- running, succeeded, failed, dead_letter, budget_exceeded
  attempt INT NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE harness_checkpoints (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE harness_leases (
  ticket_id BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

A Redis lease is acceptable if it is durable enough for the deployment; Postgres keeps the audit trail simpler.

## Lease and heartbeat

- Claim: insert/update `harness_leases` with `expires_at = NOW() + HARNESS_LEASE_SECONDS`, conditional on no unexpired lease.
- Heartbeat: update `expires_at` and `harness_runs.heartbeat_at` every `HARNESS_HEARTBEAT_SECONDS`.
- Reaper: `SELECT ... FOR UPDATE SKIP LOCKED` expired leases; mark runs failed, release tickets, queue cleanup.
- Defaults: lease 10 minutes, heartbeat 30 seconds, reaper every 60 seconds.

## Recovery policy

On `AgentApp` startup:

1. find `harness_runs` where `agent_id = me` and `status = running`;
2. if the heartbeat is fresh or its lease is unexpired, assume another
   instance is alive and skip;
3. otherwise reconcile based on the last checkpoint:
   - `PUBLISHING`/`DONE` with a stored head sha or PR -> look up an **open**
     PR and adopt the run as succeeded (`HARNESS_RESUME_MODE=resume`); a run
     that already recorded `pr_url` is adopted in either mode;
   - every other checkpoint -> fail the run and return the ticket only through
     the guarded release path, because the OpenCode session and uncommitted
     workspace are process-local and cannot be resumed;
4. if the run cannot be finished, leave it for the terminal-run reconciliation
   sweep; never release on an unconfirmed state.

`HARNESS_RESUME_MODE=restart` is the default and only adopts runs with a
recorded PR URL. `resume` additionally looks up an open PR from a stored head
sha. The workspace, branch and ticket must still match the run record.

## Idempotent publishing

- Compute an idempotency key: `ticket_id + branch + commit_sha`.
- Before pushing, check whether the branch exists and whether the expected commit is already the head.
- Before opening a PR, query by head branch and reuse the existing PR URL.
- Store `pr_url` and `head_sha` on the run before returning.
- A retry after a crash must be safe to run twice.

## Workspace registry and cleanup

Track workspace paths in `harness_runs.workspace_path` and clean them at agent
startup after recovery succeeds:

- remove generated workspace names with no running run/unexpired lease and an
  old mtime;
- never delete a workspace with an active run or unexpired lease;
- clean crash-left OpenCode/askpass temp dirs with the same retention;
- a full size/age inventory, scheduled cleanup and disk-usage/leftover metrics
  are deferred to fg-44.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HARNESS_LEASE_SECONDS` | `600` | Ticket lease TTL |
| `HARNESS_HEARTBEAT_SECONDS` | `30` | Lease renewal interval |
| `HARNESS_RETRY_PIN_ATTEMPTS` / `HARNESS_MAX_ATTEMPTS` | `3` | Agent retries before the run is marked `dead_letter`; durable attempt counts are Phase 2 |
| `HARNESS_WORKSPACE_RETENTION_HOURS` | `24` | Orphan cleanup age |
| `HARNESS_RESUME_MODE` | `restart` | `restart`, `resume` |

## Failure handling

- Publish failure: keep the run in `PUBLISHING`, retry with backoff, and mark
  the run `dead_letter` after the configured attempt threshold. Durable attempt
  counts across restarts remain Phase 2.
- Provider/session failure: recreate the session once; if it fails again, restart cleanly.
- Disk full or clone failure: fail the run, release the ticket, alert.
- Lease loss during a run: stop before publishing; never publish without a valid lease.

## Tests

These process-kill cases are a deferred CI follow-up; the current suite covers
the same transitions at the service/processor level.

- kill the agent during prompt, verification and publish; assert resume/fail behavior;
- kill during the push after the commit exists; assert no duplicate PR;
- two agents race for the same ticket; exactly one wins;
- expired lease is reaped and the ticket is released;
- orphan workspace cleanup respects active leases;
- run/checkpoint ordering and redaction.

## Rollout

1. Ship persistence, leases and `HARNESS_RESUME_MODE=restart` in development.
2. Enable `resume` published-work adoption for one project.
3. Enable the scheduled reaper (on by default) and workspace retention.
4. Add alerts for stuck runs and dead letters.
5. Keep `restart` as the default; revisit only if live-session resume becomes possible.

## Open questions

1. Is Postgres enough for leases, or should Redis own the lease with Postgres as audit?
2. Can an OpenCode session be resumed after a process restart, or should resume always restart the prompt?
3. Should a restarted prompt replay the same context or a compact summary?
4. How long should workspaces be retained for debugging?
5. Should a human be able to adopt a dead-lettered run?

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
