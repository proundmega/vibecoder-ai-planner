# 01_ARCHITECT_REQUIREMENT.md - Ticket Dependency Gates and Readiness Enforcement (bp-134)

**Related code:** `backend/src/migrations/026_ticket_milestone_fields.sql`, `backend/src/models/ticket.js`, `backend/src/services/TicketService.js`, `backend/src/services/HarnessRunService.js`, `backend/src/services/PhaseService.js`, `backend/src/api/tickets.js`, `backend/src/controllers/ticketController.js`, `backend/src/errors/HttpError.js`, `agent/src/main/java/com/vibecode/agent/AgentApp.java`, `agent/src/main/java/com/vibecode/agent/service/ApiService.java`, `agent/src/main/java/com/vibecode/agent/model/Ticket.java`, `frontend/src/api/tickets.ts`, `frontend/src/views/TicketDetail.vue`, `frontend/src/views/TicketBoard.vue`

## Problem

Tickets already store dependencies, but dependency readiness is not enforced.

Evidence:

- `026_ticket_milestone_fields.sql` adds `tickets.depends_on BIGINT[]`.
- `models/ticket.js` reads/writes `dependsOn` and `TicketService.update()` rejects circular dependencies.
- `TicketService.validateDependencies()` checks incomplete dependencies but has **no callers**.
- `TicketService.pickUpTicket()` only checks `status=backlog` and no assigned agent.
- `TicketService.updateStatus()` delegates straight to the model transition.
- `AgentApp.processCycle()` fetches backlog tickets and calls `processTicket()` without a dependency check.

A planner can therefore return `010 depends_on 005`, but an agent can still start 010 while 005 is open.

## Goals

1. Make `depends_on` an execution constraint, not only metadata.
2. Cover every path that moves a ticket into `in_progress`.
3. Fail closed on missing, deleted, self, cross-project or unreadable dependencies.
4. Give agents and humans a machine-readable explanation of what is blocking.
5. Keep blocked tickets visible in the planner while removing them from the agent backlog queue.
6. Avoid a schema migration by reusing the existing column and completion contract.
7. Preserve current behavior for done tickets and phase-based completion.

## Non-goals

- Dependency graph visualisation beyond a simple blocked/ready display.
- Cross-project dependencies.
- Automatic scheduling or capacity planning across agents.
- Automatic dependency creation from text or planning files.
- Changing the ticket status state machine or making dependencies mutable only by admins.

## Current state audit: every path into execution

| Path | Entry point | Current behavior | Gap |
|---|---|---|---|
| Agent pickup | `POST /tickets/:id/pickup` → `TicketService.pickUpTicket()` | checks backlog, project access, unassigned | no dependency check |
| Status endpoint | `POST /tickets/:id/status` → `TicketService.updateStatus()` | delegates to `Ticket.updateStatus()` | no dependency check |
| Ticket update | `PUT /tickets/:id` → `TicketService.update()` | can set `status=in_progress` | no dependency check |
| Phase transition | `POST /tickets/:id/phases/transition` → `PhaseService.transition()` | can map a phase to `in_progress` | no dependency check |
| Durable run start | `HarnessRunService.startRun()` | creates/claims a run for an in-progress ticket | no dependency check on new starts |
| Durable recovery | `HarnessTicketProcessor.recoverRun()` | resumes an already-started run | must stay exempt so recovery does not strand work |
| Agent backlog query | `ApiService.listBacklogTickets()` → project tickets route | returns every backlog ticket | blocked tickets consume cycles |

## Functional requirements

- **FR1 - Pickup gate:** `TicketService.pickUpTicket()` rejects a ticket whose dependencies are not complete before writing `status='in_progress'`.
- **FR2 - Transition gate:** `TicketService.updateStatus()`, `TicketService.update()` when the payload enters `in_progress`, and `PhaseService.transition()` when the target enters execution all enforce the same dependency check. A transition to the `blocked` phase is explicitly excluded: `blocked` maps to status `in_progress`, but it is the safe action for a ticket that is already in progress and must remain available when dependencies are incomplete.
- **FR3 - Durable start gate:** `HarnessRunService.startRun()` rejects a **new** durable run for a ticket whose dependencies are not complete, so a direct agent call cannot bypass FR1/FR2. Recovery of an already-started run via `HarnessTicketProcessor.recoverRun()` is exempt: it does not enter execution again, and blocking it would strand in-flight work. Recovery does not report readiness through the run API; the normal ticket read path independently reports `ready=false`/`dependency_reopened`.
- **FR4 - Fail-closed resolution:** missing, deleted, self-referential, unreadable and cross-project dependency IDs block execution. Only dependencies with `status='done'` or `phase IN ('done','deployed')` satisfy the gate. Each unresolved entry carries a machine-readable `reason` (`not_done`, `dependency_reopened`, `missing`, `deleted`, `self`, `cross_project`, `unreadable`).
- **FR5 - Blocked-by contract:** a blocked operation returns `409 DEPENDENCIES_NOT_DONE` with `blockedBy[]` entries containing `id`, nullable `title`, nullable `status`/`phase` and a `reason`, plus a human-readable message. This requires a dependency-specific error (for example `DependencyConflictError extends ConflictError`) because the current `ConflictError` hardcodes `CONFLICT` and accepts no details. The same data is exposed read-only on ticket responses as `ready` and `blockedBy[]`.
- **FR6 - Backlog filtering:** the agent backlog query excludes blocked tickets so they do not consume `MAX_TICKETS`; project and planner views still list them with `ready=false`.
- **FR7 - UI visibility:** the ticket detail and planner show a blocked badge, the prerequisite titles/IDs and the reason. The UI is read-only in this phase; dependencies remain API-authored, and no editor is added.
- **FR8 - Audit and metrics:** blocked pickup/transition attempts are observable with a count and a structured log or event; the event identifies the ticket, attempted target and blocked dependency IDs without leaking ticket content unnecessarily.

## Non-functional requirements

- **NFR1 - Atomicity:** the dependency assertion and the `in_progress` write cannot race. The check runs in the same transaction as the status update, **and the transaction locks the target ticket plus all same-project resolved dependency rows** (`SELECT ... FOR UPDATE`, ordered by id) so a concurrent dependency reopen (`done → in_progress`) serializes before or after the start rather than between check and write. A snapshot-only `NOT EXISTS` predicate is not sufficient because it does not lock dependency rows. Cross-project, self, missing, deleted or unreadable entries are rejected before the lock step and are never locked. A later reopen is allowed and only affects future starts.
- **NFR2 - Backward compatibility:** existing done/review/in-progress tickets and phase-based completion keep working. No historical ticket becomes stuck merely because it is already in progress: the gate applies to entering execution, not to recovery, and `in_progress → blocked` remains allowed.
- **NFR3 - Performance:** a single-ticket readiness check is one bounded query. List enrichment uses one batch query (for example `= ANY(depends_on)` plus a lateral/aggregate readiness projection) rather than an N+1 helper per ticket.
- **NFR4 - Scoping and integrity:** dependency checks respect project membership and existing circular-dependency validation; cross-project IDs are rejected.
- **NFR5 - Fail closed:** an unparseable or partially resolvable dependency array blocks execution rather than defaulting to ready.
- **NFR6 - No new dependency semantics:** the implementation reuses `depends_on` and does not add a second dependency table or a second completion definition.

## Acceptance criteria

1. A ticket with an open dependency cannot be picked up, moved into `in_progress`, or used to start a new durable run.
2. A ticket whose dependencies are all done can be picked up and transitioned normally.
3. Missing/deleted/self/cross-project dependencies return a blocking error with a reason, not ready.
4. Agents do not consume a `MAX_TICKETS` slot on blocked tickets.
5. The planner/detail view explains which tickets are blocking; dependencies remain API-authored.
6. Existing done/phase semantics, `in_progress → blocked`, recovery and circular-dependency detection still pass their tests.
7. The full backend Jest suite, relevant integration tests and planning check pass.

## Assumptions

| ID | Assumption | Impact if wrong | Validation/evidence |
|---|---|---|---|
| A1 | `tickets.depends_on` is the authoritative dependency field | A second graph/source could diverge | Migration/API/model inspection; no other dependency table |
| A2 | `status=done` or `phase=done/deployed` is the completion contract | Completed tickets could be treated as open | Existing `validateDependencies()` and milestone tests |
| A3 | Cross-project dependencies are not required in this phase | The design would need project-qualified IDs | Product scope; reject with a clear error |
| A4 | Service-layer enforcement is sufficient; UI is advisory | A direct API/agent path could bypass | All execution paths are listed in the audit table; durable start is gated and recovery is explicitly exempt |
| A5 | Filtering blocked tickets from the agent backlog is acceptable | Agents would need a skip-without-count loop instead | Planner still shows all tickets; agent queue is an execution view; `Ticket` model can carry `ready` |
| A6 | No schema migration is needed | A new index/view may be required for performance | `depends_on` already exists; measure before adding indexes |
| A7 | Dependency reopening is allowed | A `done → in_progress` change could race a start | Existing `PhaseService` state machine; dependency-row locks; `dependency_reopened` warning |

## Change impact

| Area | Impact | Evidence/owner |
|---|---|---|
| API routes/contracts | Pickup/status/update/phase may return `409 DEPENDENCIES_NOT_DONE`; ticket responses gain `ready`/`blockedBy`; OpenAPI and generated frontend types are updated | `api/tickets.js`, `api/openapi-spec.js`, `frontend/src/api/generated/**` |
| Database/ migrations | No migration expected; uses existing `depends_on BIGINT[]` | `026_ticket_milestone_fields.sql` |
| Frontend | Blocked badge/detail/list with reasons; dependencies stay API-authored (no editor this phase) | `TicketDetail.vue`, `TicketBoard.vue`, `api/tickets.ts` |
| Agent/harness | Agent backlog query filters blocked tickets; `Ticket` model exposes `ready`; new durable start is gated; recovery is exempt | `AgentApp`, `ApiService`, `Ticket.java`, `HarnessRunService`, `HarnessTicketProcessor` |
| Permissions/auth | No new permission; existing project membership and `TICKET_UPDATE` apply | `TicketService`, `PhaseService` |
| Background jobs/external calls | No new job; optional audit metric/log only | `TicketService`/observability |
| Downstream tickets | Auto-approve/auto-merge (`fg-52`) must consume `ready` and dependency gates | fg-52 design |
| Rollback | Revert the service gates; no data migration to undo | service/route changes |

## Out of scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
