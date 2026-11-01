# 01_ARCHITECT_REQUIREMENT.md - Ticket Quality Gates and Definition of Ready (fg-45)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-30 (agent execution), fg-31/32 (review loop)
**Related code:** `validators/tickets.js`, `TemplateService`, `TicketPlanningService`, `PhaseService`, `TicketService.pickUpTicket`, `TicketBoard.vue`, `TicketDetail.vue`

## Problem

Templates are available but optional. The system currently allows one-line tickets to reach an agent.

Evidence:

- `createTicketSchema` requires only a title (`min(1)`); description is optional and defaults to `''`.
- `TicketBoard.vue` only exposes title and description; no template, scope, or acceptance criteria.
- `TicketDetail.vue` applies templates manually and lets a user set `planning_status` freely.
- `PhaseService.getGateStatus()` checks `planning_status === 'completed'`, but no production code calls it.
- `TicketService.pickUpTicket()` only requires `status=backlog` and no assignee. Agents claim unready tickets.

The result is predictable: vague tickets, invented scope, reviewer rejections, more fix rounds, and wasted provider budget.

## Goals

1. Define a machine-checkable **Definition of Ready (DoR)**.
2. Require a planning template (or an explicit small-fix exemption).
3. Capture scope, acceptance criteria and a test plan before implementation.
4. Make `planning_status=completed` trustworthy.
5. Block agent pickup and `backlog -> in_progress` until ready.
6. Let agents refuse unready tickets with a clear message.
7. Provide a human override with reason and audit.
8. Measure readiness and blocked tickets.
9. Avoid blocking existing in-progress work during rollout.

## Non-goals

- Forcing the full architecture template on every one-line bug fix.
- AI-generating the plan automatically (future).
- Replacing human product prioritization.
- Blocking ticket creation completely; drafts are allowed, execution is gated.
- Changing the review/fix workflow.

## Definition of Ready

A ticket is ready when all are true:

1. Title is clear and specific (not “fix stuff”).
2. Description explains the problem, context and expected behavior.
3. Scope lists what is in and out.
4. At least one testable acceptance criterion exists.
5. A template is applied (`architecture`, `technical`, `simple`, or a project template), **or** a `small_fix` exemption is recorded with a reason.
6. Required template files exist and are non-empty.
7. Required sections are filled; placeholder markers like `{{DATE}}`, `TBD`, `TODO` are rejected.
8. A human/architect has marked the plan complete (or the small-fix exemption is approved).
9. Dependencies, test plan and rollback/risk are documented for non-small tickets.

### Small-fix exemption

Allowed only when all are true:

- single-file or clearly bounded change;
- no schema/API/contract change;
- no new dependency;
- test or verification path is obvious;
- reason is recorded and audited.

If any condition is false, a template is required.

## Template selection

| Template | Use when |
|---|---|
| `architecture` | Multi-file feature, migration, API/UI coupling, new subsystem |
| `technical` | Medium backend/frontend change without product ambiguity |
| `simple` | Small, well-understood task with a short task list |
| `specification` | Implementation-ready ticket that needs only a spec |
| project custom | Team-specific requirements |

## Functional requirements

- **FR1 - Create schema:** require title, description (min length), priority, and either a template or small-fix exemption.
- **FR2 - Acceptance criteria:** add a dedicated field or a required template section; validate at least one criterion.
- **FR3 - Readiness service:** `GET /tickets/:id/readiness` returns `ready`, `issues[]`, `template`, `planningStatus`.
- **FR4 - Pickup gate:** `pickUpTicket` returns 409/422 with `READINESS_FAILED` and issue codes when not ready.
- **FR5 - Phase gate:** `review`/`backlog -> in_progress` requires readiness or an approved override.
- **FR6 - Planning completion:** `planning_status=completed` is set only by the readiness service after validation, or by an authorized human/architect with audit.
- **FR7 - Placeholder detection:** reject `{{...}}`, `TBD`, `TODO`, empty required sections.
- **FR8 - Override:** `POST /tickets/:id/readiness/override` requires a reason, permission and audit event.
- **FR9 - Agent behavior:** on `READINESS_FAILED`, post the issues to the ticket, release it and do not start a harness session.
- **FR10 - UI:** creation wizard with template/small-fix selection; readiness panel on the ticket with issues and actions.
- **FR11 - Migration:** grandfather existing in-progress/review tickets; apply the gate to new backlog tickets.
- **FR12 - Metrics:** readiness rate, blocked count, time-to-ready, most common missing items.

## Safety requirements

- The gate must be enforced in the backend, not only the UI.
- An override must be permission-checked and audited; it must not silently mark a ticket ready.
- Do not expose secrets or internal file contents in readiness errors.
- Existing tickets must not be unexpectedly released or blocked mid-flight.
- Agents must never bypass the gate to “help”.

## Acceptance criteria

1. A title-only ticket is created as a draft but cannot be picked up.
2. A ticket with a template and valid required files is ready and claimable.
3. A small-fix ticket with an approved exemption is claimable with an audit record.
4. Placeholders/empty required sections produce specific issue codes.
5. `GET /tickets/:id/readiness` returns accurate results.
6. Pickup and phase transition enforce readiness with clear errors.
7. Agents post the issues and release unready tickets.
8. An authorized override requires a reason and is audited.
9. Existing in-progress/review tickets are grandfathered during rollout.
10. Metrics show readiness rate and blocked tickets.
11. Tests cover schema, service, routes, gates, UI and override.

## Out of scope

- Automatic plan generation.
- Estimating effort or cost from the plan.
- Enforcing a specific wording of acceptance criteria.
- Cross-project template inheritance.
- Replacing the planner’s human product process.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | AI-assisted plan drafting | Agent / UX | `fg-30` Phase 2 | No |
| 2 | fg-31 | Reviewer checks readiness criteria | Review | `fg-31` follow-up | No |
| 3 | fg-46 | Readiness/blocked metrics | Observability | `fg-46-flow-observability` | No |
| 4 | fg-37 | Measure quality vs readiness | Evaluation | `fg-37-agent-evaluation-harness` | No |
