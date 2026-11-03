# 01_ARCHITECT_REQUIREMENT.md - Ticket Quality Gates and Definition of Ready (fg-45)

**Related code:** `validators/tickets.js`, `TemplateService`, `TicketPlanningService`, `PhaseService`, `TicketService`, `models/ticket.js`, `TicketController`, `middleware/permissions.js`, `agent/harness/HarnessTicketProcessor.java`, `agent/service/TicketProcessor.java`, `TicketBoard.vue`, `TicketDetail.vue`, `frontend/src/api/tickets.ts`

## Problem

Templates are available but optional. The system currently allows one-line tickets to reach an agent.

Evidence:

- `createTicketSchema` requires only a title (`min(1)`); description is optional and defaults to `''`.
- `TicketBoard.vue` only exposes title and description; no template, scope, or acceptance criteria.
- `TicketDetail.vue` applies templates manually and lets a user set `planning_status` freely.
- `PhaseService.getGateStatus()` checks `planning_status === 'completed'`, but no production code calls it.
- `TicketService.pickUpTicket()` only requires `status=backlog` and no assignee. Agents claim unready tickets.

The result is predictable: vague tickets, invented scope, reviewer rejections, more fix rounds, and wasted provider budget.

## Current state audit: every path that starts work

The gate only helps if it covers all of them. Today the following paths move a ticket into execution, and **none** of them checks readiness:

| Path | Entry point | Current write |
|---|---|---|
| Agent pickup | `POST /api/v1/tickets/:id/pickup` → `TicketService.pickUpTicket` (`TicketService.js:267-272`) | `UPDATE status='in_progress', assigned_agent_id, locked_at` |
| UI “Start Work” | `TicketDetail.vue:115` → `updateTicket` → `PUT /api/v1/tickets/:id` (`frontend/src/api/tickets.ts:36`) → `TicketService.update` → `Ticket.update` (`models/ticket.js:89-97`) | sets `status`; `VALID_TRANSITIONS` allows `backlog -> in_progress` |
| Status endpoint | `POST /api/v1/tickets/:id/status` (`api/tickets.js:146`) → `TicketService.updateStatus` (`TicketService.js:207`) → `Ticket.updateStatus` (`models/ticket.js:169-181`) | sets `status` only |
| Phase transition | `POST /api/v1/tickets/:id/phases/transition` → `PhaseService.transition` (`PhaseService.js:51-68`) | writes `phase` **and** `status`; `PHASE_TO_STATUS` maps `assigned`/`in_progress`/`blocked` → `in_progress` |
| Planning status | `PATCH /api/v1/tickets/:id/planning/status` (`api/v1/index.js:181`) | `verifyToken` only; `TicketPlanningService.updateStatus` accepts `completed` directly |

Two consequences shape the design:

1. **Phase transitions are not the normal path.** Agents pick up by writing `status`; `tickets.phase` stays `draft` unless someone calls `PhaseService`. The gate must key off the status transition, not the phase.
2. **`completed` is currently a free text update.** `planning_status=completed` must become a derived, service-owned state or the readiness signal is meaningless.

Phase transitions into `in_progress` come from `assigned`, `blocked`, `review` and `done` (`PhaseService.js:6-17`), not from `backlog`. `backlog` is a status, not a phase.

## Goals

1. Define a machine-checkable **Definition of Ready (DoR)**.
2. Require a planning template (or an explicit small-fix exemption).
3. Capture scope, acceptance criteria and a test plan before implementation.
4. Make `planning_status=completed` trustworthy and service-owned.
5. Gate **every** path into execution: pickup, `POST /status`, `PUT /tickets/:id` with a status change, and phase transitions whose target maps to `in_progress` (enforced in `enforce` mode; `warn` logs and allows).
6. Let agents refuse unready tickets with a structured, machine-readable error.
7. Provide a scoped human override with reason and audit.
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
8. The plan has been explicitly approved by an authorized human.
9. Dependencies, test plan and rollback/risk are documented for non-small tickets.

**Enforcement point:** the DoR is checked when work starts, not when the ticket is created. A title-only ticket is a valid draft (`status=backlog`, `phase=draft`) and simply cannot be picked up or moved into `in_progress`. There is no separate `draft` status; “draft” is shorthand for that pair.

### Small-fix exemption

Allowed only when all are true:

- single-file or clearly bounded change;
- no schema/API/contract change;
- no new dependency;
- test or verification path is obvious;
- reason is recorded and audited.

If any condition is false, a template is required.

### Small fix vs override

These are **different mechanisms** and must not share state:

| Mechanism | Effect | Scope | Expiry |
|---|---|---|---|
| Small-fix exemption | Waives template presence, required files and required sections (conditions 5-6, plus the section half of 7). Placeholder checks, conditions 1-4 and 8 still apply; condition 9 does not apply to small fixes. | One ticket, recorded by `small_fix_by/at/reason` | Permanent for that ticket |
| Readiness override | Waives named issue codes with a reason | `readiness_waived_codes[]` on one ticket | Required `readiness_override_expires_at` (max 30 days) |

An override never waives `PLAN_NOT_APPROVED` silently and never bypasses every check: it lists the codes it waives, and unlisted checks still run.

## State model

There is no circular “completed before validation” step. The states are explicit columns:

| State | Written by | Meaning |
|---|---|---|
| `planning_status=not_started/template_selected/in_progress` | existing planning endpoints | authoring in progress |
| `plan_approved_at/by` | `POST /tickets/:id/readiness/approve-plan` | an authorized human approved the content |
| `planning_status=completed` | same transaction as `plan_approved_at` | approval recorded; not the readiness signal |
| `ready_at/by` | same transaction, only when every non-waived check passes | ticket is claimable |
| `small_fix_at/by/reason` | `POST /tickets/:id/readiness/small-fix` | template exemption |
| `readiness_override_at/by/reason/waived_codes/expires_at` | `POST /tickets/:id/readiness/override` | scoped waiver |

`GET /readiness` evaluates the ticket as it is now. `approve-plan` validates all content checks, records the approval, and sets `ready_at` only if nothing else is outstanding. If content changes later, the next evaluation can fail again: readiness is **recomputed**, never assumed from `planning_status`.

## Template selection

| Template | Use when |
|---|---|
| `architecture` | Multi-file feature, migration, API/UI coupling, new subsystem |
| `technical` | Medium backend/frontend change without product ambiguity |
| `simple` | Small, well-understood task with a short task list |
| `specification` | Implementation-ready ticket that needs only a spec |
| project custom | Team-specific requirements |

Required sections are declared per template file (`requiredSections` in `file_definitions`). The evaluator reads that metadata; it does not guess headings.

## Functional requirements

- **FR1 - Create schema stays permissive:** `projectId` and `title` remain required; `description` and `priority` keep their defaults. Optional creation inputs are `template`, `acceptanceCriteria[]` and `smallFix { reason }`. Creation never fails for readiness reasons and never blocks drafts. DoR enforcement happens at pickup/transition (FR5).
- **FR2 - Acceptance criteria:** store criteria in a dedicated `ticket_acceptance_criteria` table (source of truth). A `## Acceptance Criteria` section in a planning file is parsed once at migration/apply-template time to seed the table, then the table wins. At least one non-empty criterion is required.
- **FR3 - Readiness service:** `GET /tickets/:id/readiness` returns `ready`, `issues[]` (`code`, `message`, `field`), `template`, `planningStatus`, `waivedCodes[]` and `expiresAt`.
- **FR4 - Pickup gate:** `pickUpTicket` throws `ReadinessError` → HTTP **409** `{ code: "READINESS_FAILED", details: { issues: [...] } }`. 409 (not 422) because the ticket state conflicts with the request; the issue list is machine-readable.
- **FR5 - All execution paths gated:** one assertion, `assertReadyForExecution(ticket, target)`, called from `pickUpTicket`, `TicketService.updateStatus`, `TicketService.update` (only when `status` changes into `in_progress`), and `PhaseService.transition` whenever the target phase maps to `in_progress` (`assigned`, `in_progress`, `blocked`) or the new status is `in_progress`. The assertion honors `READINESS_GATE_MODE=off|warn|enforce`: `off` skips, `warn` records and allows, `enforce` throws. The default is `warn`; only `enforce` blocks.
- **FR6 - Planning completion is service-owned:** `PATCH /tickets/:id/planning/status` keeps working for `not_started`, `template_selected` and `in_progress` (route gains `TICKET_UPDATE`), but rejects `completed` with 409 `PLANNING_STATUS_FORBIDDEN` and rejects any transition out of `completed` with 409 `REPLAN_REQUIRED`. Only the readiness service writes `completed`, together with `plan_approved_at` and (when clean) `ready_at`. Post-approval planning-file edits and `apply-template` keep `planning_status='completed'` while checks still pass; a failing edit invalidates the approval (FR16). Re-authoring requires `POST /tickets/:id/readiness/replan`, which clears `plan_approved_at/by` and `ready_at/by` and audits the change.
- **FR7 - Placeholder detection:** reject `{{...}}`, `TBD`, `TODO`, `FIXME` and empty required sections.
- **FR8 - Override:** `POST /tickets/:id/readiness/override` requires `TICKET_READINESS_OVERRIDE`, project membership, a reason, explicit `waivedCodes[]` and an expiry; writes a `ticket_readiness_events` audit row. `DELETE` writes a revocation row.
- **FR9 - Small-fix exemption:** `POST /tickets/:id/readiness/small-fix` requires the same permission and project membership, records a reason, and waives template presence, required files and required sections (`MISSING_TEMPLATE`, `MISSING_REQUIRED_FILE`, `EMPTY_REQUIRED_FILE`, `MISSING_REQUIRED_SECTION`). Title, description, scope, acceptance criteria, placeholder and approval checks still apply; dependencies/test/rollback (`MISSING_TEST_PLAN`, `MISSING_DEPENDENCIES`, `MISSING_ROLLBACK`) do not apply to a small fix.
- **FR10 - Agent behavior:** on `READINESS_FAILED`, both the legacy `TicketProcessor` and `HarnessTicketProcessor` post the issue list to the ticket, release it, and do not clone or start a harness.
- **FR11 - UI:** creation wizard with template/small-fix selection; readiness panel with issues and actions; both `TicketDetail` **and** the `TicketBoard` drag/drop path must surface readiness issues, and `frontend/src/api/tickets.ts` must propagate errors for `updateTicket` and `createTicket` (no `.catch(() => null)`).
- **FR12 - Migration:** grandfather existing in-progress/review/done tickets; gate only new work.
- **FR13 - Metrics:** readiness rate, blocked count, time-to-ready, waived-code frequency, agent pickups rejected.
- **FR14 - Audit:** readiness approvals, approval invalidations, small-fix exemptions, override grants/revocations/expiries and blocked attempts are written to a real table (see design) because `audit_log` does not exist yet (bp-124 O2). Blocked attempts are written **after** the status transaction ends (after `COMMIT` in `warn`, after `ROLLBACK` in `enforce`), exactly once via `attemptId`, so neither a rollback, an FK lock timeout nor a successful warn-mode transition loses the evidence.
- **FR15 - Project scoping:** approval, small-fix, replan and override require `assertProjectMember`; there is no existing membership check on project or ticket reads (`ProjectService.getOne` and `Ticket.findByProject` ignore `userId`), so this ticket adds a shared helper rather than assuming one exists.
- **FR16 - Content-bound approval:** a post-approval content edit re-evaluates immediately. If checks still pass, approval and `ready_at` stay. If checks fail, `plan_approved_at/by` and `ready_at/by` are cleared, `planning_status` returns to `in_progress`, and an `approval_invalidated` event is written; fixing the content does **not** restore readiness — a human must approve again. `replan` clears the same fields including the `*_by` actors.

## Safety requirements

- The gate must be enforced in the backend, not only the UI.
- Every unauthenticated or agent-facing path into `in_progress` is gated; there is no side door.
- An override must be permission-checked, project-scoped, reason-bearing, code-scoped and expiring; it must not silently mark a ticket ready.
- `planning_status=completed` cannot be written outside the readiness service.
- Do not expose secrets or internal file contents in readiness errors.
- Existing tickets must not be unexpectedly released or blocked mid-flight.
- Agents must never bypass the gate to “help”.

## Acceptance criteria

1. A title-only ticket is created as a draft (`status=backlog`, `phase=draft`) and, in `enforce` mode, cannot be picked up or moved to `in_progress` (`warn` records the block and allows).
2. A ticket with a template and valid required files is ready and claimable.
3. A small-fix ticket with an approved exemption is claimable, and the audit row records only the template/file/section waivers (dependencies/test/rollback are not applicable; placeholders and criteria are still checked).
4. Placeholders/empty required sections produce specific issue codes.
5. `GET /tickets/:id/readiness` returns accurate results.
6. Pickup, `POST /tickets/:id/status`, `PUT /tickets/:id` with `status=in_progress`, and phase transitions mapping to `in_progress` all return 409 `READINESS_FAILED` in `enforce` mode.
7. `PATCH /tickets/:id/planning/status` rejects `completed` and any move out of `completed` (`REPLAN_REQUIRED`); `apply-template`/planning-file edits that still pass keep `planning_status='completed'`; a post-approval edit that fails invalidates approval (`approval_invalidated`) and returns to `in_progress`; fixing it requires re-approval; `POST /readiness/replan` clears approval/ready and is audited.
8. Agents post the issues and release unready tickets; neither processor starts a harness.
9. An authorized override requires a reason, an expiry, a permission, project membership, and is audited; unlisted codes still block; revocation is audited.
10. `ready_at` tracks evaluation: passing edits re-set it, failing edits clear approval + `ready_at`, override revocation clears it, and waiver expiry clears it via the sweep. Approval is content-bound: a failing edit cannot become ready again without `approve-plan`.
11. Existing in-progress/review tickets are grandfathered during rollout.
12. Metrics show readiness rate and blocked tickets.
13. `READINESS_GATE_MODE=off|warn|enforce` behaves as specified, with tests for all three.
14. Tests cover schema, evaluator, all five write paths, planning-status guard, override, project scoping, agent handling, backfill and UI.

## Impact analysis

| Area | Impact |
|---|---|
| API | New readiness routes; `PUT /tickets/:id` and `POST /tickets/:id/status` can now return 409; `PATCH /planning/status` rejects `completed` |
| Agent | New structured error type in the Java client; both processors need the failure branch |
| Database | Migration adds readiness columns, `ticket_acceptance_criteria`, `ticket_readiness_events` |
| Frontend | New wizard fields, readiness panel, error propagation in `api/tickets.ts` |
| Existing data | Grandfather backfill; no ticket is released or blocked mid-flight |

## Important design decisions

1. Gate at execution boundaries, not at creation (drafts stay cheap).
2. One shared assertion rather than per-route checks, so new routes cannot forget the gate.
3. `plan_approved_at` is separate from `ready_at`; `completed` is derived, not authoritative.
4. Small-fix exemption and override are separate state.
5. Audit lives in a new table because `audit_log` is a known missing table (bp-124 O2).

## Known unknowns

- Whether `ticket_acceptance_criteria` should also support checklists embedded in `04_SPECIFICATION.md`; the table is authoritative in Phase 1.
- Minimum description length (proposed 80 characters) needs product confirmation.
- How project templates expose `requiredSections` today (some have arbitrary `file_definitions`); the design specifies a schema.
- Whether `member` should ever hold `TICKET_READINESS_OVERRIDE`; Phase 1 restricts it to `project_admin`/`super_admin`.

## Testing checklist

- [ ] Unit: evaluator returns every issue code.
- [ ] Unit: `assertReadyForExecution` called by all five paths (spy/mock).
- [ ] Route: pickup, `POST /status`, `PUT /tickets/:id`, `PATCH /planning/status` return 409/`PLANNING_STATUS_FORBIDDEN`.
- [ ] Route: phase transition into `assigned`/`in_progress`/`blocked` is gated; `backlog` is not a phase gate.
- [ ] Service: `approve-plan` on an incomplete ticket sets neither `completed` nor `ready_at`.
- [ ] Service: approve then edit → readiness recomputed false.
- [ ] Permission: override without `TICKET_READINESS_OVERRIDE` → 403; expired/waived scope honored.
- [ ] Agent: both processors post issues, release, start no harness.
- [ ] Frontend: `updateTicket` propagates the 409; TicketDetail shows issues.
- [ ] Migration: grandfathered tickets stay claimable.

## Out of scope

- Automatic plan generation.
- Estimating effort or cost from the plan.
- Enforcing a specific wording of acceptance criteria.
- Cross-project template inheritance.
- Replacing the planner’s human product process.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
