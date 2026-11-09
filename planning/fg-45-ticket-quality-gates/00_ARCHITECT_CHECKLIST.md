---
id: "fg-45"
title: "Ticket Quality Gates and Definition of Ready"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-08"
pr: null
branch: null
depends_on: ["fg-30", "fg-31"]
---

# 00 — Ticket Quality Gates and Definition of Ready (fg-45)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `validators/tickets.js`, `TemplateService`, `TicketPlanningService`, `PhaseService`, `TicketService`, `models/ticket.js`, `middleware/permissions.js`, `agent/harness/HarnessTicketProcessor.java`, `agent/service/TicketProcessor.java`, `TicketBoard.vue`, `TicketDetail.vue`, `frontend/src/api/tickets.ts`

## Why this ticket exists

Planning templates exist, but nothing enforces them. A ticket can be created with only a title, picked up by an agent, and implemented without scope, acceptance criteria, plan or tests. The existing planning gate (`PhaseService.getGateStatus`) is only used by tests. Five separate paths move a ticket into execution and none of them checks readiness.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | AI-assisted plan drafting, including assumptions and failure modes | fg-30 | Agent / UX | fg-30 Phase 2 | open |
| D2 | Reviewer checks readiness criteria | fg-31 | Review | fg-31 follow-up | open |
| D3 | Measure quality vs readiness | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D4 | Enforce project membership in `ProjectService.getOne`/`Ticket.findByProject` (they currently ignore `userId`) | fg-45 | Security | bp-124 follow-up | open |
| D5 | Readiness/blocked metrics | fg-46 | Observability | fg-46-flow-observability | open |
| D6 | Traceability consumes the requirement IDs exported by this ticket | self | Review | fg-51-requirement-traceability | open |

## Important design decisions

1. Gate at execution boundaries; drafts stay cheap.
2. One assertion in the service layer, not per-route checks.
3. `plan_approved_at` is the approval fact; `planning_status=completed` mirrors it.
4. `ready_at` is only set after validation; an override is a scoped waiver, not “ready”.
5. Small-fix exemption ≠ override.
6. Readiness is recomputed on read; stale `completed` never grants access.
7. The risk review is **structural**: readiness verifies that assumptions,
   failure modes, security considerations and change impact are present and
   placeholder-free. The independent reviewer (`fg-31`/`fg-47`) and the human
   judge whether the content is real.
8. The risk review is not a new phase. It runs inside plan approval/pickup;
   traceability (`fg-51`) runs inside `review -> human_approval` and merge.

## Known unknowns

- Minimum description length (proposal 80 characters).
- Whether `member` should hold the override permission (Phase 1: no).
- Whether custom templates must declare `requiredSections` (Phase 1: optional, warn).
- Whether acceptance criteria should also parse `04_SPECIFICATION.md` (Phase 1: table is authoritative).
- Which templates require which risk sections (proposal: `architecture`,
  `technical` and `specification` require all four; `simple` requires
  assumptions and change impact).
- Whether a security-sensitive `simple` ticket must always carry a security
  section (proposal: yes, derived from scope/planning content).

## Testing checklist

- [ ] Evaluator unit tests for all issue codes.
- [ ] Gate tests for pickup, `POST /status`, `PUT /tickets/:id`, phase transitions, planning status.
- [ ] All three gate modes (`off`/`warn`/`enforce`).
- [ ] `ready_at` lifecycle: passing/failing edits, criteria, template, revocation, expiry sweep, content-bound re-approval
- [ ] `approve-plan` transactional tests (no partial completion).
- [ ] `completed -> in_progress` / `apply-template` / post-approval upsert tests; failing edit invalidates approval; `replan` clears approval/ready and actors.
- [ ] Override permission/scope/expiry tests; project-membership tests for approve, small-fix, replan and override.
- [ ] Audit actor types (user/agent/system); blocked rows emitted after COMMIT/ROLLBACK, exactly once (no FK lock, no duplicate).
- [ ] Java processor tests for both legacy and harness modes.
- [ ] Backfill/grandfather migration test.
- [ ] Missing/empty/placeholder assumptions, failure modes, security
      considerations and change impact each produce a specific issue code.
- [ ] Small-fix exemption waives conditions 11-14 but still checks
      assumptions, placeholders, criteria and approval.
- [ ] Security-sensitive scope (auth, permissions, migrations, agent boundary,
      external calls, secrets) requires the security section.
- [ ] Requirement IDs are stable across re-approval; renaming/removing one
      requires `replan`.
- [ ] Frontend error propagation (detail + board) and readiness panel test.
