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
| `harness_reaper_last_success_timestamp_seconds` | Last successful sweep |

Suggested alerts:

- `time() - harness_reaper_last_success_timestamp_seconds > 180` — reaper is not
  completing sweeps.
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

Use adoption rather than releasing the ticket:

```bash
curl -X POST "$API/api/v1/harness/runs/$RUN_ID/adopt" \
  -H "Authorization: Bearer $OPERATOR_JWT"
```

The backend adopts only a terminal run with a PR, never overwrites an existing
different ticket PR, keeps `done` tickets done, and moves `in_progress`/`backlog`
to `review`.

## Dead-letter a stuck run

```bash
curl -X POST "$API/api/v1/harness/runs/$RUN_ID/dead-letter" \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"error":"stuck in publish; verified manually"}'
```

This deletes the lease, sets `dead_letter`, clears `reconciled_at`, and lets the
next sweep either adopt publish evidence or release the ticket through the
normal guards. A succeeded run cannot be dead-lettered.

## Manual sweep

The reaper runs every `HARNESS_REAPER_INTERVAL_SECONDS` (default 60). With the
interval disabled, run a sweep from a one-off process:

```bash
node -e "require('./backend/src/services/HarnessReaper').runOnce().then(console.log)"
```

## Workspace retention

`HARNESS_WORKSPACE_RETENTION_HOURS` (agent, default `24`, `0` disables) prunes
clone directories older than the window at startup. The agent never deletes its
current workspace. Active runs in another process sharing the clone root are
protected by the modification-time check; use one clone root per agent identity.

## Crash scenarios

- **Crash before clone**: next poll/reaper recovers; no workspace exists.
- **Crash after clone/session/prompt**: run stays `running` until the lease
  expires, then is failed and the ticket is released if there is no PR/head
  evidence.
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
- Do not dead-letter a succeeded run.
