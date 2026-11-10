# 02_ARCHITECT_DESIGN.md - Ticket Dependency Gates and Readiness Enforcement (bp-134)

## Design summary

Add one dependency-readiness assertion and call it from every path that can start work. Reuse the existing `depends_on` column and completion contract.

```
Ticket 010 depends_on [005]
  -> readiness(ticket) = all deps done/deployed ?
       yes -> ready
       no  -> blockedBy[] -> 409 DEPENDENCIES_NOT_DONE
  -> service gates: pickup | updateStatus | update(status) | phase transition | durable start
  -> agent backlog query excludes ready=false
  -> planner/detail shows ready=false + blockedBy[]
```

## Readiness calculation

The canonical helper lives in `TicketService` and returns:

```json
{
  "ready": false,
  "blockedBy": [
    { "id": "5", "title": "Create the schema", "status": "in_progress", "phase": "assigned" }
  ]
}
```

Rules:

- Empty/absent `depends_on` → ready.
- Every dependency must resolve to a ticket in the same project.
- A dependency is complete when `status='done'` or `phase IN ('done','deployed')`.
- Missing, deleted, self, cross-project or unreadable IDs → `ready=false` with a distinct reason code.
- `10` depends on `5` is directed: `10` is blocked, `5` is unaffected.
- The helper is read-only; it does not mutate dependencies.

## Enforcement matrix

| Path | Code | Gate location |
|---|---|---|
| Agent pickup | `TicketService.pickUpTicket()` | before the `UPDATE ... status='in_progress'` |
| Status endpoint | `TicketService.updateStatus()` | before the model update when target is `in_progress` |
| Ticket PUT | `TicketService.update()` | when the payload changes status into `in_progress` |
| Phase transition | `PhaseService.transition()` | when target phase maps to `in_progress` |
| Durable start | `HarnessRunService.startRun()` or the shared assertion it calls | before creating/claiming the run |
| Agent queue | `ApiService.listBacklogTickets()` / backend query | `WHERE` excludes tickets whose dependencies are incomplete |

## Atomicity and concurrency

Two acceptable implementations:

1. **Single query with `NOT EXISTS`:** include the dependency predicate in the same `UPDATE` as the status write, then inspect the affected row count.
2. **Transaction + row lock:** `SELECT ... FOR UPDATE` the ticket, evaluate dependencies, then update in the same transaction.

The second is easier to explain and matches the readiness/error contract. It also prevents a dependency edit from racing the start. A dependency moving from done back to open is not a supported transition, so the remaining race is a dependency deletion; treat a deleted dependency as blocking.

## Error contract

```json
{
  "success": false,
  "error": {
    "code": "DEPENDENCIES_NOT_DONE",
    "message": "Cannot start: 2 dependencies are not done",
    "details": {
      "ticketId": "10",
      "blockedBy": [
        { "id": "5", "title": "Create the schema", "status": "in_progress", "phase": "assigned" }
      ]
    }
  }
}
```

HTTP status: `409` for pickup/transition conflicts. The same `blockedBy[]` is exposed on ticket GET/list responses as `ready` and `blockedBy[]` with no mutation.

## Backlog filtering

`listBacklogTickets()` should return only `ready=true` tickets for agent execution. Project ticket lists (planner) keep all tickets and include `ready=false` plus `blockedBy[]`.

If filtering server-side is too broad for one PR, the fallback is:
- return `ready` on each backlog ticket,
- make `AgentApp` skip `ready=false` without incrementing `processed`,
- keep the service gate as the hard boundary.

The hard boundary is the service gate; filtering is a throughput optimization.

## UI

- Ticket detail: read-only “Blocked by” list with links; existing dependency editor remains for authorized users.
- Board/list: blocked badge and a tooltip/label naming the first blocker.
- Error surface: show the returned `blockedBy[]`, not a generic failure.
- No new permission is required.

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation/test | Operator action |
|---|---|---|---|---|
| Dependency check bypassed | A new path writes `in_progress` directly | Integration test enumerates all paths; code review of `UPDATE tickets SET status` | Shared assertion + grep/test for writes | Revert the path; add a regression |
| Missing dependency treated as done | Dependency ticket deleted or malformed array | Unit test with missing ID | Fail closed with `ready=false` | Repair the dependency data |
| Race between dependency edit and start | Concurrent update | Transaction/lock test or `NOT EXISTS` under concurrency | Same-transaction assertion | Re-run the blocked start |
| Performance regression | N+1 readiness calls on backlog listing | Query count test / EXPLAIN | One bounded query or SQL predicate | Add an index or batch query |
| Existing ticket stranded | Historical in-progress ticket with open deps | Backfill report | NFR2: never gate an already-in-progress ticket | Leave it; only new starts are gated |
| Cross-project ID silently compared | IDs overlap across projects | Unit test with same numeric ID in two projects | Reject as not found/cross-project | Fix the dependency data |

## Security considerations

- **Authorization:** use the existing project membership/`TICKET_UPDATE` checks; do not trust the client to send only same-project IDs.
- **Input validation:** `depends_on` is an array of BigInts; reject non-integers, self, duplicate and cross-project IDs at write time where practical. The read gate still fails closed.
- **Data exposure:** `blockedBy[]` exposes only dependency id/title/status to callers who can already read the ticket/project. No description or secret-bearing content.
- **Audit:** blocked-start logs must not include ticket descriptions or credentials; log IDs, target action and reason codes.
- **Denial of service:** a malformed or huge dependency array must not cause unbounded queries; cap array length at write time or use a single `ANY` query.
- **No privilege escalation:** a dependency gate must not become a way to edit or read another project's tickets by probing IDs.

## Rollout

1. Add the readiness helper and unit tests.
2. Gate pickup and status transitions; observe blocked attempts in logs.
3. Add the backlog filter so blocked tickets do not consume agent cycles.
4. Add `ready`/`blockedBy` to read contracts and the UI.
5. Add durable-start coverage.
6. Run the full backend suite plus the PostgreSQL integration tests.

The gate is backward-compatible: it only affects tickets that are not already in progress.
