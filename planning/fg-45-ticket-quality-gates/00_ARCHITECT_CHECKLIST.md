---
id: "fg-45"
title: "Ticket Quality Gates and Definition of Ready"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-22"
pr: null
branch: null
depends_on: ["fg-30"]
---

# 00 — Ticket Quality Gates and Definition of Ready (fg-45)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

**Related code:** `validators/tickets.js`, `TemplateService`,
`TicketPlanningService`, `PhaseService`, `TicketService`, `models/ticket.js`,
`middleware/permissions.js`, `agent/harness/HarnessTicketProcessor.java`,
`TicketBoard.vue`, `TicketDetail.vue`, `frontend/src/api/tickets.ts`.

## Relationship to fg-54 (implemented)

The pickup contract uses `assigned_runtime_id`, and readiness checks apply to
runtime roles (`worker`/`reviewer`/`planner`). The legacy `TicketProcessor` and
the `agents` table are gone; only `HarnessTicketProcessor` remains. Readiness
events therefore key agent actors by `runtime_id`/`node_id`, not `agent_id`.

## Why this ticket exists

Planning templates exist, but nothing enforces them. A ticket can be created
with only a title, picked up by an agent, and implemented without scope,
acceptance criteria, plan or tests. `PhaseService.getGateStatus` is only used by
tests. Five separate paths move a ticket into execution and none checks
readiness.

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Dependencies | keep fg-31+fg-50 / narrow fg-31 and defer fg-50 | Narrow fg-31 to its readiness integration; defer the fg-50 template-drift test | Answered 2026-11-22 |
| 2 | Rollout | warn+grandfather / enforce+grandfather / enforce+block existing | `READINESS_GATE_MODE=warn` default; grandfather existing in-progress/review/done | Answered 2026-11-22 |
| 3 | Override/small-fix permission | project_admin+super_admin / include member / super_admin only | `project_admin` + `super_admin` | Answered 2026-11-22 |
| 4 | Minimum description | 80 / 120 / none | 80 characters | Answered 2026-11-22 |
| 5 | Risk sections by template | all four for architecture/technical/specification; simple gets assumptions + change impact | Adopt; security-sensitive `simple` always gets security | Answered 2026-11-22 |
| 6 | Custom template sections | required / optional with warning | Optional; `sectionsEnforced: false` | Assumed |
| 7 | Acceptance criteria source | table authoritative / also parse `04` | Table authoritative in Phase 1 | Assumed |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | AI-assisted plan drafting, including assumptions and failure modes | fg-30 | Agent / UX | fg-30 Phase 2 (fg-55) | open |
| D2 | Reviewer consumes readiness criteria and rejects unready plans | fg-31 | Review | fg-31 integration; not a blocker for this ticket | open |
| D3 | Measure quality vs readiness | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D4 | Enforce project membership in `ProjectService.getOne`/`Ticket.findByProject` | fg-45 | Security | bp-124 follow-up | open |
| D5 | Readiness/blocked metrics | fg-46 | Observability | fg-46-flow-observability | open |
| D6 | Traceability consumes the exported requirement IDs | self | Review | fg-51-requirement-traceability | open |
| D7 | Template-drift test that keeps root/product risk sections aligned | fg-50 | Testing | fg-50-planning-template-hygiene; deferred so this ticket can land first | open |
| D8 | Tune the 80-character description threshold from real ticket data | self | UX | after the pilot | open |
| D9 | Decide whether custom templates must declare `requiredSections` | self | UX | after the pilot | open |
| D10 | Parse acceptance criteria from `04_SPECIFICATION.md` as a secondary source | self | UX | after the pilot | open |

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
9. fg-31 and fg-50 are integration/quality follow-ups (D2/D7), not hard
   dependencies; the readiness gate works with human review.

## Known unknowns

- Whether acceptance criteria should also parse `04_SPECIFICATION.md` (Phase 1:
  table is authoritative; D10).
- Whether custom templates must declare `requiredSections` (Phase 1: optional,
  warn; D9).
- Whether the 80-character description minimum is right after real usage (D8).

## Testing checklist

- [ ] Evaluator unit tests for all issue codes.
- [ ] Gate tests for pickup, `POST /status`, `PUT /tickets/:id`, phase
      transitions, planning status.
- [ ] All three gate modes (`off`/`warn`/`enforce`).
- [ ] `ready_at` lifecycle: passing/failing edits, criteria, template,
      revocation, expiry sweep, content-bound re-approval.
- [ ] `approve-plan` transactional tests (no partial completion).
- [ ] `completed -> in_progress` / `apply-template` / post-approval upsert
      tests; failing edit invalidates approval; `replan` clears approval/ready
      and actors.
- [ ] Override permission/scope/expiry tests; project-membership tests for
      approve, small-fix, replan and override.
- [ ] Audit actors (user/runtime/system); blocked rows emitted after
      COMMIT/ROLLBACK, exactly once.
- [ ] `HarnessTicketProcessor` tests: post issues, release, start no harness.
- [ ] Backfill/grandfather migration test.
- [ ] Missing/empty/placeholder assumptions, failure modes, security
      considerations and change impact each produce a specific issue code.
- [ ] Small-fix exemption waives template/files/sections but still checks
      assumptions, placeholders, criteria and approval.
- [ ] Security-sensitive scope requires the security section.
- [ ] Requirement IDs are stable across re-approval; renaming/removing one
      requires `replan`.
- [ ] Frontend error propagation (detail + board) and readiness panel test.
