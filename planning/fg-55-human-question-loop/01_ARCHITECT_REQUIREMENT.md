# 01 — Requirement (fg-55)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

The harness cannot ask a human anything. `question` and `doom_loop` are denied
in the generated OpenCode config, the client drives one blocking prompt with no
question handler, and the planner has no question or notification tables. A
blocked decision therefore becomes a guess or a failed run, and an operator
only finds out by reading logs or GitHub.

## Goals

1. Let a run ask a question, park, notify a human, accept an answer and resume.
2. Notify the operator when a run succeeds (PR ready), fails, or exceeds budget.
3. Replace the non-portable `doom_loop` permission with a supervisor-side
   repetition policy that escalates to a question and then fails closed.
4. Keep the waiting run recoverable: lease/heartbeat continue, the wall-clock
   budget pauses, and a timeout or crash releases the ticket cleanly.
5. Ship the in-app bell, question inbox and ticket question card.

## Non-goals

- Email, Slack or other external channels (D1).
- Realtime push; the MVP polls (D2).
- Durable suspend/resume across a supervisor restart (D3); a waiting run is
  recoverable, not resumable, in this phase.
- Plan approval, autonomy tiers, auto-merge or multi-agent handoff
  (`fg-31`/`fg-32`/`fg-40`/`fg-52`).
- Reviewer findings (`fg-31`).

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | The question loop is behind `HARNESS_QUESTION_LOOP` (default off). When on, the generated OpenCode config allows `question`; when off, it stays `deny`. | Config-writer test asserts the permission in both modes; an off run behaves exactly like Phase 1. |
| FR2 | On a `question` (or permission) event, the supervisor persists a `ticket_questions` row, sets `harness_runs.waiting_since`, keeps the lease heartbeat alive and polls for an answer. | Fake OpenCode server emits a question; the run row has `waiting_since`, a pending question row, and the lease is renewed while waiting. |
| FR3 | An authorized project member can answer through `POST /harness/runs/:runId/questions/:questionId/answer`; the supervisor injects the answer into the same session and clears `waiting_since`. | Answer API returns 200, the question is `answered`, the fake server receives the reply, and the run continues. |
| FR4 | A waiting run times out after `HARNESS_QUESTION_TIMEOUT_MINUTES` (default 60). On timeout the question is `expired`, the run fails with `question_timeout`, the sandbox is destroyed and the ticket/lease are released. | Timeout test asserts `question_timeout`, no publish, no lease, and a released ticket. |
| FR5 | A repeated tool-call signature raises a `doom_loop` question after `HARNESS_DOOM_LOOP_MAX` (default 3) repeats; a human "continue" resets the counter, and exceeding the cap fails the run with `doom_loop`. | Processor test drives repeated calls; question kind is `doom_loop`; continue resets; cap fails and never publishes. |
| FR6 | `notifications` stores per-user rows (`question`, `run_succeeded`, `run_failed`, `budget_exceeded`) with a project/ticket/run link, payload, `read_at`; the API lists, counts unread and marks read. | Backend integration test creates/reads/marks rows; a second user cannot read another user's notifications. |
| FR7 | Question creation and run finish create notifications in the same transaction as the state change. | Service test asserts one notification per recipient and no row when the transaction rolls back. |
| FR8 | The UI shows a global bell with an unread count, a question inbox, and a ticket question card with an answer box; it polls every 30s and links to the run/PR. | Vitest tests for the bell/inbox/card; Cypress component test for answer submission and empty/error states. |
| FR9 | Authorization and redaction: only project members (or super_admin) can read/answer; an agent can create a question only for its own runtime/run; question/answer text and notification payloads pass fg-42 redaction; answer length is capped. | Route tests cover member/owner/member-other/agent/outside; redaction test injects a credential-shaped string and asserts it is not stored or returned. |
| FR10 | Events and audit: `question.asked`, `question.answered`, `question.timeout`, `doom_loop.escalated` and `notification.created` are emitted with run/trace correlation; the timeline shows them. | Event-service test and supervisor event-sink test assert the types and correlation ids. |
| FR11 | Recovery: a supervisor restart while waiting expires the pending question and fails/releases the run through the existing recovery path; the reaper continues to treat the run as active while heartbeat is fresh. | Processor recovery test and reaper test assert the states; no duplicate run or PR. |
| FR12 | Documentation and indexes: env vars in `agent/README.md`, the harness section in `AGENTS.md`, the pilot runbook, `PENDING.txt` and the roadmap are updated. | `node planning/check-planning.js` passes; docs name the new env vars and the flag. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | No unbounded blocking: the wait is bounded by the timeout, the lease heartbeat continues, and the prompt thread cannot hang forever. | Timeout test; heartbeat assertion; no test exceeds the configured timeout. |
| NFR2 | Budget fairness: wall-clock wait time is excluded (`waited_ms`), while token/cost/tool caps remain authoritative. | Budget-tracker test pauses/resumes; a long wait does not consume the wall-clock budget. |
| NFR3 | Backward compatibility: flag off is the default and matches Phase 1 behavior; no migration rewrites existing rows. | Default-config test; migration is additive. |
| NFR4 | Privacy: question/answer/notification text follows fg-42 redaction and retention; no secret reaches a bell payload. | Redaction test; no raw credential in API/db/event. |
| NFR5 | Test-first and coverage: stub files are created before production code; backend/frontend coverage stays at or above 60%. | `04` lists the stubs first; CI coverage passes. |

## In scope

- `backend/src/migrations/060_ticket_questions_notifications.sql` (+ rollback).
- `backend/src/services/TicketQuestionService.js`,
  `NotificationService.js`, route modules and validators.
- `HarnessRunService` waiting columns, recovery and finish integration.
- Agent `OpenCodeConfigWriter`, `OpenCodeClient`, `HarnessTicketProcessor`,
  `HarnessBudgetTracker` and event sink.
- Frontend `NotificationBell.vue`, `QuestionInbox.vue`,
  `TicketQuestionCard.vue`, API client and router.
- Tests at every layer and the docs/index updates.

## Out of scope

Summarise only. The authoritative list with reasons and follow-ups is **`00` →
Deferred register**.

- Email/Slack, realtime push, durable suspend/resume, templates/auto-answer,
  multi-agent handoff, per-project policy.

## Known unknowns

1. **OpenCode 1.19.5 question reply contract** — confirm the exact endpoint and
   payload from the running server's `/doc`/OpenAPI. If the pinned version has
   no reply path, fail closed and keep the flag off; do not fake a resume.
2. **Blocking prompt survival** — verify with a fake server that the prompt call
   stays open while the question is answered, or that the answer can be posted
   on a second connection. If neither works, the design must switch to a
   non-blocking message API before implementation.
3. **Notification recipients** — owner plus `project_memberships`; decide
   whether role/permission filtering is needed (recommend owner + members with
   `AGENT_READ`).
4. **Doom-loop signature** — whether to hash tool name + normalized args or
   count consecutive identical calls; pick one in `02` and test it.
5. **Reaper interaction** — a waiting run keeps `status='running'` and a fresh
   heartbeat, so the existing stuck-run query should not reap it; verify.

## Dependencies

- fg-30 Phase 1 (merged): supervisor, OpenCode client, publishing.
- fg-33 (merged): runs/checkpoints/leases/recovery.
- fg-41 (merged): event stream, redaction, timeline.
- fg-54 (merged): node/runtime identity and `runtime_id` attribution.
- fg-42 (merged): redaction policy used by FR9/NFR4.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
