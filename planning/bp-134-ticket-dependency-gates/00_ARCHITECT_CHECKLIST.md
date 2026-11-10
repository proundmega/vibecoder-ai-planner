---
id: "bp-134"
title: "Ticket Dependency Gates and Readiness Enforcement"
status: planned
priority: "P1"
effort: "Medium"
scope: "Both"
created: "2026-11-10"
updated: "2026-11-10"
pr: null
branch: null
depends_on: []
---

# 00 — Ticket Dependency Gates and Readiness Enforcement (bp-134)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `backend/src/migrations/026_ticket_milestone_fields.sql`, `backend/src/models/ticket.js`, `backend/src/services/TicketService.js`, `backend/src/services/HarnessRunService.js`, `backend/src/api/tickets.js`, `backend/src/services/AgentService.js`, `agent/src/main/java/com/vibecode/agent/AgentApp.java`, `frontend/src/api/tickets.ts`, `frontend/src/views/TicketDetail.vue`

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

## Important design decisions

1. Enforce in the service layer, not only in the UI or planner.
2. Reuse the existing `depends_on BIGINT[]` column; no schema migration is planned.
3. **Fail closed:** a missing, deleted, unreadable, self, or cross-project dependency blocks execution. An array entry that cannot be resolved is not treated as done.
4. Dependency completion uses the existing contract: `status=done` or `phase=done`/`deployed`.
5. Gate every path into `in_progress`: agent pickup, status transition, ticket update, phase transition, and durable harness start.
6. Filter blocked tickets from the agent backlog query so they do not consume a `MAX_TICKETS` cycle; keep them visible in the planner.
7. Expose `ready` and `blockedBy[]` so the UI and planner can explain the block without guessing.
8. Do not support cross-project dependencies in this phase; reject them rather than silently comparing IDs from another project.

## Known unknowns

- Whether a dependency may be satisfied by `phase=review` rather than `done` (proposal: no; `done`/`done`/`deployed` only).
- Whether dependency edits should be allowed after a ticket reaches `in_progress` (proposal: yes, but they only affect future starts).
- Whether the planner should show blocked tickets in the agent queue with a badge or keep them out entirely (proposal: out of the agent query, visible in project views).
- Whether the service should return `409` or `422` for a blocked pickup (proposal: `409 DEPENDENCIES_NOT_DONE`, matching the existing state-conflict style).
- Whether a durable recovery may start a blocked ticket (proposal: no; the same gate applies).

## Testing checklist

- [ ] Unit: incomplete dependency blocks pickup.
- [ ] Unit: all dependencies done allows pickup.
- [ ] Unit: missing/deleted/self/cross-project dependency fails closed.
- [ ] Unit: dependency chain and circular-dependency behavior unchanged.
- [ ] API: blocked pickup returns `409 DEPENDENCIES_NOT_DONE` with `blockedBy[]`.
- [ ] API: status transition, ticket update and phase transition into `in_progress` are gated.
- [ ] Harness: durable start/recovery cannot bypass the gate.
- [ ] Backlog query excludes blocked tickets; project/planner listing still shows them.
- [ ] UI: blocked badge/detail renders the dependency titles and IDs.
- [ ] Integration: real Postgres pickup and transition tests.
- [ ] Regression: existing done/phase semantics and milestone/dependency persistence.
