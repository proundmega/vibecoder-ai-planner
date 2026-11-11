---
id: "bp-134"
title: "Ticket Dependency Gates and Readiness Enforcement"
status: in_review
priority: "P1"
effort: "Medium"
scope: "Both"
created: "2026-11-10"
updated: "2026-11-11"
pr: 137
branch: "feat/bp-134-ticket-dependency-gates"
depends_on: []
---

# 00 — Ticket Dependency Gates and Readiness Enforcement (bp-134)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `backend/src/migrations/026_ticket_milestone_fields.sql`, `backend/src/models/ticket.js`, `backend/src/services/TicketService.js`, `backend/src/services/HarnessRunService.js`, `backend/src/services/PhaseService.js`, `backend/src/api/tickets.js`, `backend/src/controllers/ticketController.js`, `backend/src/errors/HttpError.js`, `agent/src/main/java/com/vibecode/agent/AgentApp.java`, `agent/src/main/java/com/vibecode/agent/service/ApiService.java`, `agent/src/main/java/com/vibecode/agent/model/Ticket.java`, `frontend/src/api/tickets.ts`, `frontend/src/views/TicketDetail.vue`, `frontend/src/views/TicketBoard.vue`

## Why this ticket exists

Runtime tickets already have a `depends_on` column, model field, API field and circular-dependency check, but **nothing enforces dependencies when work starts**. `TicketService.validateDependencies()` exists and is never called. `pickUpTicket()` only checks `status=backlog` and that no agent is assigned, so an agent can pick up a dependent ticket while its prerequisite is still open.

The planner can therefore store a dependency graph, but it cannot yet use it as an execution constraint. Scheduling all tickets would let agents run dependent work early.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Dependency graph visualisation in the planner board | self | UX | bp-134 follow-up | open |
| D2 | Cross-project dependencies | self | Scope | bp-134 follow-up | open |
| D3 | Cleanup or audit of orphaned dependency IDs after a ticket is hard-deleted | self | Reliability | bp-134 follow-up | open |
| D4 | Dependency-aware scheduling and capacity planning across agents | self | Orchestration | fg-40 | open |
| D5 | Blocked-dependency metrics in the flow dashboard | self | Observability | fg-46 | open |
| D6 | Dependency editor UI (create/remove dependencies from the board/detail view) | self | UX | bp-134 follow-up | open |

## Important design decisions

1. Enforce in the service layer, not only in the UI or planner.
2. Reuse the existing `depends_on BIGINT[]` column; no schema migration is planned.
3. **Fail closed:** a missing, deleted, unreadable, self, or cross-project dependency blocks execution. An array entry that cannot be resolved is not treated as done.
4. Dependency completion uses the existing contract: `status=done` or `phase=done`/`deployed`.
5. Gate every path that **enters execution** (`in_progress`): agent pickup, status transition, ticket update, and a phase transition that enters `in_progress`. Do not gate `in_progress → blocked`, which is the safe action for an already-started ticket. A new durable start is gated; recovery of an already-started run is exempt.
6. Filter blocked tickets from the agent backlog query so they do not consume a `MAX_TICKETS` cycle; keep them visible in the planner.
7. Expose `ready` and `blockedBy[]` so the UI and planner can explain the block without guessing. The UI is read-only; dependencies remain API-authored in this phase.
8. Do not support cross-project dependencies in this phase; reject them rather than silently comparing IDs from another project.
9. Reopening a dependency (the existing `done → in_progress` transition) is allowed. The start gate serializes against it by locking the dependency rows; a later reopen does not retroactively start anything, and the dependent is marked `ready=false` with a `dependency_reopened` reason.

## Known unknowns

- Whether a dependency may be satisfied by `phase=review` rather than `done` (proposal: no; `status=done` or `phase=done`/`deployed` only).
- Whether dependency edits should be allowed after a ticket reaches `in_progress` (proposal: yes, but they only affect future starts).
- Whether the planner should show blocked tickets in the agent queue with a badge or keep them out entirely (proposal: out of the agent query, visible in project views).
- Whether the service should return `409` or `422` for a blocked pickup (proposal: `409 DEPENDENCIES_NOT_DONE`, matching the existing state-conflict style).

Resolved: dependency reopening is allowed (the existing state machine supports `done → in_progress`); the start gate locks dependency rows and records a `dependency_reopened` warning rather than blocking recovery. Recovery of an already-started run is exempt from the new-start gate. Dependencies stay API-authored; no editor is added in this phase.

## Testing checklist

- [ ] Unit: incomplete dependency blocks pickup.
- [ ] Unit: all dependencies done allows pickup.
- [ ] Unit: missing/deleted/self/cross-project dependency fails closed.
- [ ] Unit: dependency chain and circular-dependency behavior unchanged.
- [ ] API: blocked pickup returns `409 DEPENDENCIES_NOT_DONE` with `blockedBy[]` and a reason.
- [ ] API: status transition, ticket update and phase transition that enters `in_progress` are gated.
- [ ] API: `in_progress → blocked` remains allowed even when dependencies are incomplete.
- [ ] Harness: a new durable start cannot bypass the gate; recovery of an already-started run is exempt and does not strand the ticket.
- [ ] Backlog query excludes blocked tickets; project/planner listing still shows them with batch-enriched `ready`/`blockedBy`.
- [ ] UI: blocked badge/detail renders the dependency titles, IDs and reasons; no dependency editor is claimed.
- [ ] Integration: real Postgres pickup, transition, reopen-race and list tests.
- [ ] Regression: existing done/phase semantics and milestone/dependency persistence.
