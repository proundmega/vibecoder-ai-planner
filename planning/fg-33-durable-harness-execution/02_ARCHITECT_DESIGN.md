# 02_ARCHITECT_DESIGN.md - Durable Harness Execution (fg-33)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor)

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
2. if the heartbeat is fresh, assume another instance is alive and skip;
3. otherwise resume based on the last checkpoint:
   - `CLONED` -> reuse workspace if valid, else restart clone;
   - `SESSION_READY`/`PROMPTING` -> recreate the OpenCode session and resend a bounded prompt (or restart cleanly if the provider cannot resume);
   - `VERIFYING` -> rerun verification;
   - `PUBLISHING` -> check for the branch/PR and finish idempotently;
4. after `HARNESS_MAX_ATTEMPTS`, mark `dead_letter` and release the ticket for a human.

Resume is only allowed if the workspace, branch and ticket still match the run record. Otherwise restart cleanly and record why.

## Idempotent publishing

- Compute an idempotency key: `ticket_id + branch + commit_sha`.
- Before pushing, check whether the branch exists and whether the expected commit is already the head.
- Before opening a PR, query by head branch and reuse the existing PR URL.
- Store `pr_url` and `head_sha` on the run before returning.
- A retry after a crash must be safe to run twice.

## Workspace registry and cleanup

Track workspace paths in `harness_runs.workspace_path` plus a periodic inventory:

- remove workspaces with no active lease and `updated_at < retention`;
- never delete a workspace with an unexpired lease;
- clean temporary OpenCode config/home with the workspace;
- report disk usage and leftover count as metrics.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HARNESS_LEASE_SECONDS` | `600` | Ticket lease TTL |
| `HARNESS_HEARTBEAT_SECONDS` | `30` | Lease renewal interval |
| `HARNESS_MAX_ATTEMPTS` | `3` | Retries before dead letter |
| `HARNESS_WORKSPACE_RETENTION_HOURS` | `24` | Orphan cleanup age |
| `HARNESS_RESUME_MODE` | `safe` | `safe`, `restart`, `off` |

## Failure handling

- Publish failure: keep the run in `PUBLISHING`, retry with backoff, then dead letter.
- Provider/session failure: recreate the session once; if it fails again, restart cleanly.
- Disk full or clone failure: fail the run, release the ticket, alert.
- Lease loss during a run: stop before publishing; never publish without a valid lease.

## Tests

- kill the agent during prompt, verification and publish; assert resume/fail behavior;
- kill during the push after the commit exists; assert no duplicate PR;
- two agents race for the same ticket; exactly one wins;
- expired lease is reaped and the ticket is released;
- orphan workspace cleanup respects active leases;
- run/checkpoint ordering and redaction.

## Rollout

1. Ship persistence and lease with recovery disabled (`HARNESS_RESUME_MODE=off`) in development.
2. Enable safe resume for one project.
3. Enable the reaper and workspace retention.
4. Add alerts for stuck runs and dead letters.
5. Make safe resume the default after a bake period.

## Open questions

1. Is Postgres enough for leases, or should Redis own the lease with Postgres as audit?
2. Can an OpenCode session be resumed after a process restart, or should resume always restart the prompt?
3. Should a restarted prompt replay the same context or a compact summary?
4. How long should workspaces be retained for debugging?
5. Should a human be able to adopt a dead-lettered run?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Structured events and replay | Observability | `fg-41-harness-observability` | No |
| 2 | fg-34 | Sandboxed workspaces | Security | `fg-34-harness-sandbox` | No |
| 3 | fg-40 | Parallel worktree leases | Agent | `fg-40-multi-agent-orchestration` | No |
| 4 | fg-38 | Budget-aware retry policy | Billing | `fg-38-harness-budgets-routing` | No |
