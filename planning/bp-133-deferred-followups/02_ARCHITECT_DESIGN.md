# 02 — Design (bp-133)

> **Owns:** current-state audit, design, contracts, risks, rollout.
> **Not here:** status/deferred scope (`00`), requirements (`01`), matrix (`03`).

## Current-state audit

- **D12:** `frontend/src/api/generated/models/Ticket.ts`, `Project.ts` and
  `Agent.ts` still use stale snake_case fields; `frontend/src/api/generated`
  is unused by typed callers but is the published client surface.
- **D13:** the route JSDoc in `backend/src/api/*.js` (e.g. `tickets.js`,
  `projects.js`, `users.js`, `agents.js`) still documents BIGSERIAL ids as
  `format: uuid` on path parameters and request bodies. `openapi-spec.js`
  only has the legitimate `milestoneId` UUID; it scans the route files via its
  `apis` glob, so the route JSDoc is the source to fix.
- **D14:** `UserService.listUsers()` builds a `WHERE` clause without a
  `deleted_at IS NULL` predicate, so soft-deleted accounts stay listed.
- **D16:** `TicketService.update()` / `delete()` / `releaseTicket()` rely on
  the global `TICKET_*` permissions; they do not check
  `project_memberships` or project ownership.

## Design

### FR1 — generated client

Regenerate from the committed spec (`generate:api`), then reconcile imports.
Keep generated files unedited by hand. If a generated shape changes a caller,
fix the caller rather than the generated file. The diff is expected to be
large; review it as generated output plus the small caller changes.

### FR2 — OpenAPI id formats

Edit the route JSDoc files under `backend/src/api/*.js` (the `apis` glob in
`openapi-spec.js` is the actual source). Reuse `NumericId` where a `$ref` is
possible; otherwise document `type: string`, `pattern: '^[0-9]+$'`. Keep
`milestoneId` as `uuid` because `milestones.id` is UUID. Regenerate the spec
and extend the guard test to walk `specs.paths` (path parameters and request
bodies), not only `components.schemas`.

### FR3 — soft-deleted users

Add `AND deleted_at IS NULL` to both `listUsers` and `listAllUsers`
predicates (and to any pagination count). The super-admin table uses
`listAllUsers`, so fixing only the project-admin list leaves the same bug
visible. Use unit tests with a mocked pool plus an integration assertion
against a real DB.

### FR4 — project membership

Resolve the project for the ticket and allow the action when the actor is:

1. the project owner,
2. an active `project_memberships` member, or
3. `super_admin` (and `project_admin` per the existing bypass policy).

Pickup/release authorization currently lives in `ticketController.js`:
`pickUpTicket` uses `req.agent` and `releaseTicket` receives `{ operatorId }`
but `TicketService.releaseTicket()` ignores it. Normalize the actor in the
controller (`{ agentId, operatorId, role }`) and pass it to both
`TicketService.pickUpTicket()` and `releaseTicket()`; the services verify the
project/assignment. Keep the agent path keyed to
`assigned_agent_id = agents.id` (bp-124 O4). Tests must cover owner, member,
non-member and admin for update, pickup and release.

## Contracts

- FR1/FR2 do not change runtime responses; they change the documented/generated
  surface. No migration is required.
- FR3 changes only the list query.
- FR4 changes authorization outcomes; no schema change.

## Risks

- **FR1:** a large generated diff can hide real changes; review generated
  files separately from hand-written callers.
- **FR2:** over-tightening a path schema can break clients that send numeric
  ids as numbers; keep runtime validation permissive (numeric string or
  number), document the response as a string.
- **FR3:** a deleted user must not disappear from audit/history joins; only the
  admin list query changes.
- **FR4:** the existing admin bypass must not regress. This is the highest-risk
  item and needs its own review round.

## Rollout

Ship FR1-FR3 as one low-risk slice, then FR4 separately with authorization
tests and a review. Update `00` status and `03` results as each slice lands.
