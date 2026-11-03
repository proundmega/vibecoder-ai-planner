# 05 — Runbook (bt-60)

Operational procedure for the disposable staging run. Test-only: never use a
production ticket, repository, PR, credential or database.

## Preconditions

- Disposable/isolated host. The staging agent executes real repo code while
  fg-34 sandbox (D9) is still open.
- Dedicated test project and test GitHub repository.
- GitHub token scoped to the one test repo; revoke it after the run.
- Dedicated, spend-capped provider key.
- Verified disposable `DATABASE_URL` (check the host/database name before any
  cleanup SQL).
- Test agent with provider/OpenCode/GitHub configuration.
- A trivial ticket change (one file/line) in the test repo.
- `HARNESS_MODE=opencode`
- `HARNESS_DURABILITY_REQUIRED=true`
- `HARNESS_LEASE_SECONDS=60`
- `HARNESS_HEARTBEAT_SECONDS=10`
- `HARNESS_MAX_DURATION_MINUTES=5`
- `HARNESS_VERIFY_COMMANDS=<fast, safe command>`

## Health signals

| Signal | Normal | Investigate |
|---|---|---|
| `harness_runs.status` | `succeeded` | `failed` / `running` after the budget |
| `harness_checkpoints.step` | reaches `done` | stuck before `publishing` |
| `harness_leases` | no row after finish | lease still held |
| Ticket state | `review` with `pr_url` | `in_progress` with no live run |
| GitHub | exactly one branch/PR | duplicate branch or PR |

## Inspect

```sql
SELECT id, ticket_id, status, step, attempt, head_sha, pr_url
FROM harness_runs WHERE ticket_id = :ticket_id ORDER BY started_at DESC;

SELECT step, created_at FROM harness_checkpoints
WHERE run_id = :run_id ORDER BY created_at;

SELECT * FROM harness_leases WHERE ticket_id = :ticket_id;
```

## Happy path

1. Create the test project/repo/ticket; record `project_id`, `ticket_id`,
   `agent_id`.
2. Ensure the ticket is `backlog` and the agent is polling the test project.
3. Start the agent; let it pick up the ticket.
4. Observe `harness_runs`/`harness_checkpoints`/`harness_leases` and the
   ticket/PR.
5. Assert:
   - one run, `status=succeeded`, `step=done`, branch/base/head_sha/pr_url populated;
   - checkpoints `cloned → session_ready → prompting → verifying → publishing
     → done`;
   - no lease row after finish;
   - ticket `review` with `pr_url`; agent heartbeat cleared;
   - exactly one test PR/branch.
6. Record the evidence (run ID, PR URL) without secrets.

## Failure cases

- **Finish unavailable after PR**: use a proxy/controlled outage; assert the
  ticket stays `review`, the run is recoverable, and the processor does not
  release/reset the ticket. If this cannot be reproduced without production
  changes, rely on `successFinishFailureNeverResetsAReviewedTicket` and record
  the staging reproduction as deferred.
- **Key expired/revoked mid-run**: assert no push/PR; the failure is fatal; the
  ticket is left for recovery.
- **Lease loss/expired before publish**: assert no push/PR; the ticket is left
  for recovery.
- **Duplicate start/lease**: assert 409 and no clone.
- **Crash/restart**: assert startup recovery skips a fresh run, fails/releases
  a stale run without publish evidence, and adopts a run with published work;
  assert the reaper reconciles the terminal run and no duplicate PR appears.
- **Scheduled reaper/ticket release**: assert release only when the ticket is
  `in_progress`, has no `pr_url`, and the run has no publish evidence.

## Cleanup

- Close/delete the test PR and branch if safe.
- Delete the test ticket/project/agent and harness rows; use the IDs recorded
  above.
- Revoke the GitHub token and provider key.
- If cleanup is blocked, run:

```sql
DELETE FROM harness_checkpoints WHERE run_id IN
  (SELECT id FROM harness_runs WHERE ticket_id = :ticket_id);
DELETE FROM harness_leases WHERE ticket_id = :ticket_id;
DELETE FROM harness_runs WHERE ticket_id = :ticket_id;
DELETE FROM tickets WHERE id = :ticket_id;
DELETE FROM agents WHERE id = :agent_id;
DELETE FROM projects WHERE id = :project_id;
```

(Use the actual test IDs; never run against production.)

## Do not

- Use a product ticket, repo, PR or database.
- Reuse a long-lived GitHub token or an uncapped provider key.
- Leave a test PR/branch, lease or agent running.
- Run cleanup SQL before confirming `DATABASE_URL` is the disposable test
  database.
