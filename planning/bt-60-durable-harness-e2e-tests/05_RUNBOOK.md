# 05 — Runbook (bt-60)

Operational procedure for the disposable staging run. Test-only: never use a
production ticket, repository, PR, credential or database.

> **fg-54 clean cut.** A node is enrolled once and declares runtimes; the
> legacy `agents` table, `AGENT_ID`/`AGENT_API_KEY`, `api_key_expires_at` and
> `HARNESS_MODE` no longer exist. Harness rows are keyed by `runtime_id`.
> See `planning/DONE/fg-54-agent-fleet/05_RUNBOOK.md` for the enrollment path.

## Preconditions

- Disposable/isolated host. The staging agent executes real repo code; use the
  fg-34 Docker sandbox (`SANDBOX_MODE=docker`, `SANDBOX_REQUIRE=true`).
- Dedicated test project and test GitHub repository; GitHub App installation
  scoped to that one repo (or a revocable repo-scoped token in local mode).
- Dedicated, spend-capped provider key and a verified model tagged `worker`.
- Verified disposable `DATABASE_URL` (check the host/database name before any
  cleanup SQL) with the clean-cut migrations applied.
- One enrolled node and one `worker` runtime with an active project grant.
- A trivial ticket change (one file/line) in the test repo.
- `HARNESS_DURABILITY_REQUIRED=true`
- `HARNESS_LEASE_SECONDS=60`
- `HARNESS_HEARTBEAT_SECONDS=10`
- `HARNESS_MAX_DURATION_MINUTES=5`
- `HARNESS_VERIFY_COMMANDS=<fast, safe command>`

The agent reaches OpenCode through the supervisor; there is no
`HARNESS_MODE` switch. Runtime identity comes from `SUPERVISOR_CONFIG` and is
injected by the supervisor.

## Health signals

| Signal | Normal | Investigate |
|---|---|---|
| `agent_nodes.status` | `active` | `revoked` / `draining` |
| `agent_runtimes.status` | `running` | `pending` / `stopped` |
| `harness_runs.status` | `succeeded` | `failed` / `running` after the budget |
| `harness_checkpoints.step` | reaches `done` | stuck before `publishing` |
| `harness_leases` | no row after finish | lease still held |
| Ticket state | `review` with `pr_url` | `in_progress` with no live run |
| GitHub | exactly one branch/PR | duplicate branch or PR |

## Inspect

```sql
SELECT r.id, r.ticket_id, r.runtime_id, r.status, r.step, r.attempt,
       r.head_sha, r.pr_url
FROM harness_runs r WHERE r.ticket_id = :ticket_id ORDER BY r.started_at DESC;

SELECT step, created_at FROM harness_checkpoints
WHERE run_id = :run_id ORDER BY created_at;

SELECT * FROM harness_leases WHERE ticket_id = :ticket_id;

SELECT rt.id, rt.name, rt.role, rt.status, rt.current_project_id,
       n.status AS node_status
FROM agent_runtimes rt JOIN agent_nodes n ON n.id = rt.node_id
WHERE rt.id = :runtime_id;
```

## Automated Phase B drills

`harnessHttpE2E` E19-E21/E29 cover crash-equivalent lease-expiry adoption,
stale-run release (including the review-ticket negative case via the reaper),
idempotent publish/reconcile, and the dead-letter/release-ticket authorization
against the real app and Postgres. These drills are merged as `c0ff5c0`
(#207). The staging steps below are still required for the real
OpenCode/GitHub/PR path; they are not replaced by the automated drills.

fg-44 (foundation #209, supervisor lifecycle #212) is merged, so the storage
prerequisite is satisfied. The pilot waits only on the disposable staging
credentials below.

## Happy path

1. Create the test project/repo/ticket; record `project_id`, `ticket_id` and
   the enrolled `runtime_id`.
2. Register the provider credential and model, verify it, and tag it `worker`.
3. Enroll the node and declare the worker runtime with `project = :project_id`.
4. Confirm the runtime is `running` and the grant is active.
5. Ensure the ticket is `backlog`; the worker polls the project backlog and
   picks it up (`POST /tickets/:id/pickup` sets `assigned_runtime_id`).
6. Observe `harness_runs`/`harness_checkpoints`/`harness_leases` and the
   ticket/PR.
7. Assert:
   - one run, `status=succeeded`, `step=done`, `finished_at` set,
     `head_sha`/`pr_url` populated, `runtime_id` matches;
   - checkpoints `cloned → session_ready → prompting → verifying → publishing
     → done`;
   - no lease row after finish;
   - ticket `review` with `pr_url`;
   - exactly one test PR/branch.
8. Record the evidence (run ID, PR URL, runtime ID) without secrets.

`agent_heartbeats` is keyed by `runtime_id`; it may retain `current_ticket_id`
until the next pickup or stale cleanup. `finishRun` updates
`harness_runs.heartbeat_at` and does not clear it.

## Failure cases

- **Finish unavailable after PR**: use a proxy/controlled outage; assert the
  ticket stays `review`, the run is recoverable, and the processor does not
  release/reset the ticket. If this cannot be reproduced without production
  changes, rely on `successFinishFailureNeverResetsAReviewedTicket` and record
  the staging reproduction as deferred.
- **Node credential revoked mid-run**: revoke the node or runtime
  (`agent_nodes.status='revoked'` or `agent_runtimes.status='stopped'`). Assert
  no push/PR, the supervisor releases its claim, and the run is left for
  recovery. (This replaces the old `api_key_expires_at` drill.)
- **Lease loss/expired before publish**: delete the lease row
  (`DELETE FROM harness_leases WHERE ticket_id = :ticket_id;`) or lower
  `HARNESS_LEASE_SECONDS` before the run; assert no push/PR and that the
  ticket is left for recovery.
- **Duplicate start/lease**: assert 409 and no clone.
- **Crash/restart**: assert startup recovery skips a fresh run, fails/releases
  a stale run without publish evidence, and adopts a run with published work;
  assert the reaper reconciles the terminal run and no duplicate PR appears.
- **Scheduled reaper/ticket release**: set `HARNESS_REAPER_INTERVAL_SECONDS=10`
  (or invoke `HarnessReaper.runOnce()`); assert release only when the ticket
  is `in_progress`, has no `pr_url`, and the run has no publish evidence.

## Cleanup

- Close/delete the test PR and branch if safe.
- Revoke the provider key and the GitHub App installation/token.
- Delete the test ticket/project/node/runtime and harness rows; use the IDs
  recorded above.
- If cleanup is blocked, run:

```sql
DELETE FROM harness_checkpoints WHERE run_id IN
  (SELECT id FROM harness_runs WHERE ticket_id = :ticket_id);
DELETE FROM harness_leases WHERE ticket_id = :ticket_id;
DELETE FROM harness_runs WHERE ticket_id = :ticket_id;
DELETE FROM tickets WHERE id = :ticket_id;
DELETE FROM provider_models WHERE credential_id = :credential_id;
DELETE FROM provider_credentials WHERE id = :credential_id;
DELETE FROM projects WHERE id = :project_id;   -- cascades grants/credentials/tickets
DELETE FROM agent_runtimes WHERE node_id = :node_id;
DELETE FROM agent_nodes WHERE id = :node_id;
```

(Use the actual test IDs; never run against production.)

## Do not

- Use a product ticket, repo, PR or database.
- Reuse a long-lived GitHub token or an uncapped provider key.
- Run an untrusted repo without the Docker sandbox and the D14 gate.
- Treat the egress allowlist as a hard host boundary while D16 is open.
- Expect the agent to ask questions until `fg-55` lands; Phase 1 denies
  `question` and `doom_loop`.
- Leave a test PR/branch, lease, runtime or node running.
- Run cleanup SQL before confirming `DATABASE_URL` is the disposable test
  database.
