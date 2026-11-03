# 05_RUNBOOK.md - Durable Harness Operations (fg-33)

Operational recovery for durable harness runs. All commands assume the backend
database and `psql` access. Never reset a ticket that has publish evidence
without an operator decision.

## Health signals

`/metrics` exposes:

| Metric | Meaning |
|---|---|
| `harness_runs_reaped_total` | Terminal runs produced by lease/orphan reaping |
| `harness_runs_reconciled_total` | Terminal runs whose ticket was reconciled |
| `harness_runs_released_total` | Tickets returned to backlog after failure |
| `harness_runs_adopted_total` | Published runs adopted into review |
| `harness_runs_needs_operator_total` | Runs left for operator handling |
| `harness_reaper_sweep_failures_total` | Incomplete sweeps (listing/reconcile errors) |
| `harness_reaper_last_success_timestamp_seconds` | Last **complete** sweep |

Suggested alerts:

- `time() - harness_reaper_last_success_timestamp_seconds > 180` — reaper is not
  completing sweeps.
- `increase(harness_reaper_sweep_failures_total[15m]) > 0` — a sweep could not
  list or reconcile a run; check backend logs.
- `increase(harness_runs_needs_operator_total[15m]) > 0` — a run needs a human.
- `increase(harness_runs_released_total[15m])` — repeated failures on tickets.

## Inspect

```sql
-- Stuck/running runs and their lease state
SELECT r.id, r.ticket_id, r.agent_id, r.status, r.step, r.agent_step,
       r.heartbeat_at, l.expires_at, r.pr_url, r.head_sha
FROM harness_runs r
LEFT JOIN harness_leases l ON l.run_id = r.id
WHERE r.status = 'running'
ORDER BY r.started_at;

-- Terminal runs waiting for reconciliation
SELECT id, ticket_id, status, pr_url, head_sha, finished_at
FROM harness_runs
WHERE status <> 'running' AND reconciled_at IS NULL
ORDER BY COALESCE(finished_at, started_at);

-- Tickets that still have a PR or publish evidence
SELECT t.id, t.status, t.pr_url, t.assigned_agent_id
FROM tickets t
WHERE t.pr_url IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM harness_runs r
     WHERE r.ticket_id = t.id
       AND (NULLIF(BTRIM(r.pr_url), '') IS NOT NULL
            OR NULLIF(BTRIM(r.head_sha), '') IS NOT NULL)
   );
```

## Recover a published run

Operator actions require a JWT with `TICKET_UPDATE` and project access; agent
keys and the `user` role are refused. Use adoption rather than releasing the
ticket:

```bash
curl -X POST "$API/api/v1/harness/runs/$RUN_ID/adopt" \
  -H "Authorization: Bearer $OPERATOR_JWT"
```

If the PR URL was lost after the PR was created, pass the operator-verified URL;
the backend fills the missing run PR and re-runs reconciliation. It refuses to
overwrite a different existing run PR. A genuinely wrong stored run PR needs an
audited manual correction or a future explicit correction action. The normal
guards also prevent overwriting an existing different ticket PR and never
regress `done`:

```bash
curl -X POST "$API/api/v1/harness/runs/$RUN_ID/adopt" \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"prUrl":"https://github.com/owner/repo/pull/123"}'
```

A succeeded run **without** a PR/head is not adoptable unless an operator
supplies the verified `prUrl`; without one, dead-letter it and let
reconciliation return the ticket through the release guard.

## Dead-letter a stuck run

```bash
curl -X POST "$API/api/v1/harness/runs/$RUN_ID/dead-letter" \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"error":"stuck in publish; verified manually"}'
```

This deletes the lease, sets `dead_letter`, clears `reconciled_at`, and lets the
next sweep either adopt publish evidence or release the ticket through the
normal guards. A succeeded run with published evidence cannot be dead-lettered;
a succeeded run with no PR/head can, which is the recovery path for that
`needs_operator` state.

## Manual sweep

The reaper runs every `HARNESS_REAPER_INTERVAL_SECONDS` (default 60). With the
interval disabled, run a sweep from the backend directory so `.env` and
`DATABASE_URL` load, and close the pool so the command exits:

```bash
cd backend
node -r dotenv/config -e "
  const Reaper = require('./src/services/HarnessReaper');
  const { pool } = require('./src/db');
  Reaper.runOnce()
    .then(summary => console.log(JSON.stringify(summary, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => pool.end());
"
```

## Workspace retention

`HARNESS_WORKSPACE_RETENTION_HOURS` (agent, default `24`, `0` disables) prunes
clone directories older than the window after startup recovery succeeds. Only
generated workspace names are touched, and the agent skips any path reported by
`GET /harness/agents/:agentId/workspaces` (running runs and unexpired leases).
If that list cannot be fetched, or an active run has no recorded workspace path,
pruning is skipped. Symlinks, non-directories,
fresh directories and the current workspace are preserved. The same sweep also
removes crash-left `opencode-harness-*` and `vibecode-askpass-*` temp dirs,
which may contain provider keys or the GitHub token.

Deployment assumptions:

- Run **one agent identity per clone root and temp namespace**. Protected paths
  are agent-scoped, while temp cleanup is global; do not share `REPO_CLONE_DIR`
  or `java.io.tmpdir` between different agents.
- Cleanup currently runs at startup after successful recovery. A long-lived
  agent will not prune again until restart; scheduled pruning is a follow-up.

## Crash scenarios

Automatic dead-letter is not implemented; repeated failures keep backing off and
need an operator dead-letter. Startup recovery skips a run whose heartbeat/lease
is still fresh, so a second process with the same agent identity cannot kill a
live run.

- **Crash before clone**: next poll/reaper recovers; no workspace exists.
- **Crash after clone/session/prompt**: run stays `running` until the lease
  expires, then is failed and the ticket is released if there is no PR/head
  evidence. Clean restart is intentional for non-published work; the old
  workspace is retained for the retention window for debugging.
- **Crash after push / during PR**: `head_sha` prevents release. Use `adopt` if
  a PR exists, otherwise reset manually after inspecting the branch.
- **Finish response lost**: `reconciled_at` retries adoption/release; never
  re-run blindly.
- **Agent key revoked/expired**: start/publish fails closed; use the operator
  endpoints above.

## Do not

- Do not clear `tickets.pr_url` or `harness_runs.head_sha` to force a retry
  without confirming the branch/PR state.
- Do not mark a `review`/`done` ticket back to `backlog` by hand unless the PR
  is closed and the branch is intentionally being replaced.
- Do not dead-letter a succeeded run with publish evidence.
