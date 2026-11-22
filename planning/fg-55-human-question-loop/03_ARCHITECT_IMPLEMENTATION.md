# 03 — Implementation (fg-55)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Test-First Requirement

Create empty test stubs with imports, `describe` blocks and stub `it` blocks
**before** any production code. Fill them in after the production files exist.

Stub files (in this order):

1. `backend/src/__tests__/ticketQuestionService.test.js`
2. `backend/src/__tests__/notificationService.test.js`
3. `backend/src/__tests__/api-questions.test.js`
4. `backend/src/__tests__/integration/ticketQuestionsNotifications.test.js`
5. `agent/src/test/java/com/vibecode/agent/harness/QuestionBridgeTest.java`
6. `agent/src/test/java/com/vibecode/agent/harness/DoomLoopDetectorTest.java`
7. `agent/src/test/java/com/vibecode/agent/harness/HarnessBudgetTrackerQuestionTest.java`
8. `frontend/src/__tests__/notificationBell.test.ts`
9. `frontend/src/__tests__/questionInbox.test.ts`
10. `frontend/cypress/component/QuestionCard.cy.ts`

## Plan

1. **Migration 060** — `ticket_questions`, `notifications`, the two
   `harness_runs` waiting columns and indexes; rollback file; register in
   `apply.js` array order (after 059).
2. **Backend services** — `TicketQuestionService` (create/read/answer/expire,
   dedupe, timeout), `NotificationService` (create/list/count/read, fanout,
   mark question read), and run integration (`waiting_since`, `waited_ms`,
   finish notifications).
3. **Backend routes/validators** — agent question create/read/expire and user
   answer/list/notifications; Joi schemas; OpenAPI JSDoc; regenerate the spec.
4. **Agent** — `OpenCodeConfigWriter` flag, `OpenCodeClient` question event and
   reply, `HarnessTicketProcessor` wait/poll/resume/timeout, budget
   pause/resume, doom-loop detector, event emission.
5. **Frontend** — bell, inbox, ticket card, API clients, router, contract test.
6. **Docs/indexes** — `agent/README.md`, `AGENTS.md`, pilot runbook,
   `PENDING.txt`, `HARNESS_ROADMAP.md`.
7. **Verification** — run the matrix; record results.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/060_ticket_questions_notifications.sql` (+ rollback) | add | Tables, indexes, `harness_runs.waiting_since`/`waited_ms` |
| `backend/src/migrations/apply.js` | change | Register 060 after 059 |
| `backend/src/services/TicketQuestionService.js` | add | Create (dedupe by `external_id`), list, answer, expire, timeout sweep |
| `backend/src/services/NotificationService.js` | add | Create/fanout, list, unread count, mark read, mark question read |
| `backend/src/services/HarnessRunService.js` | change | Waiting columns, finish notifications, recovery expiry |
| `backend/src/api/harnessRuns.js` | change | Question create/read/expire/answer routes |
| `backend/src/api/projects.js` or `questions.js` | change/add | Project question inbox route |
| `backend/src/api/notifications.js` | add | Notification list/count/read routes |
| `backend/src/api/v1/index.js` | change | Mount the routes |
| `backend/src/validators/questions.js` | add | Joi schemas and caps |
| `agent/.../harness/OpenCodeConfigWriter.java` | change | `question` allow behind the flag; keep `doom_loop` denied |
| `agent/.../harness/OpenCodeClient.java` | change | Question event parsing and reply call |
| `agent/.../harness/HarnessTicketProcessor.java` | change | Wait/poll/resume/timeout and event emission |
| `agent/.../harness/HarnessBudgetTracker.java` | change | Pause/resume active time |
| `agent/.../harness/DoomLoopDetector.java` | add | Signature counting and escalation |
| `agent/.../service/ApiService.java` | change | Question create/read/expire calls |
| `agent/.../harness/HarnessConfig.java` | change | `HARNESS_QUESTION_LOOP`, timeout, doom-loop caps |
| `frontend/src/api/questions.ts`, `notifications.ts` | add | Fetch clients |
| `frontend/src/components/NotificationBell.vue` | add | Bell + unread badge |
| `frontend/src/views/QuestionInbox.vue` | add | Inbox and answer box |
| `frontend/src/components/TicketQuestionCard.vue` | add | Ticket detail card |
| `frontend/src/App.vue`, `views/TicketDetail.vue`, `router/index.ts` | change | Mount the bell, card and route |
| `frontend/src/api/validator.ts`, `__tests__/api-contract.test.ts` | change | Contract coverage |

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Agent | `OpenCodeConfigWriterTest.java` | `question` allow/deny by flag; `doom_loop` stays deny | `cd agent && mvn test` |
| FR2 | Agent + Backend | `QuestionBridgeTest.java`, `ticketQuestionService.test.js` | event → pending row, `waiting_since`, heartbeat continues | `mvn test`, `npm test` |
| FR3 | Agent + Backend | `QuestionBridgeTest.java`, `api-questions.test.js` | member answer → reply injected, `waiting_since` cleared | `mvn test`, `npm test` |
| FR4 | Agent + Backend | `QuestionBridgeTest.java`, `ticketQuestionService.test.js` | timeout → expired, `question_timeout`, no publish/lease | `mvn test`, `npm test` |
| FR5 | Agent | `DoomLoopDetectorTest.java`, `HarnessTicketProcessorTest.java` | escalate, continue resets, cap fails, budget authoritative | `mvn test` |
| FR6 | Backend | `notificationService.test.js`, `api-questions.test.js` | create/list/count/read; cross-user denial | `npm test` |
| FR7 | Backend | `notificationService.test.js`, `harnessRunService.test.js` | one row per recipient; rollback creates none; finish types | `npm test` |
| FR8 | Frontend | `notificationBell.test.ts`, `questionInbox.test.ts`, `QuestionCard.cy.ts` | unread badge, inbox, answer submit, empty/error | `npm test -- --run`, `npm run cypress:component` |
| FR9 | Backend | `api-questions.test.js`, `ticketQuestionService.test.js` | member/owner/outside/agent scope; redaction; caps | `npm test` |
| FR10 | Agent + Backend | `HarnessTicketProcessorTest.java`, `harnessEventService.test.js` | event types and correlation ids | `mvn test`, `npm test` |
| FR11 | Agent + Backend | `HarnessTicketProcessorTest.java`, `harnessReaper.test.js` | restart expires question/fails run; waiting run not reaped | `mvn test`, `npm test` |
| FR12 | Docs | `node planning/check-planning.js` | env vars and indexes updated | `node planning/check-planning.js` |
| NFR1 | Agent | `QuestionBridgeTest.java` | bounded wait, heartbeat, no hang | `mvn test` |
| NFR2 | Agent | `HarnessBudgetTrackerQuestionTest.java` | wait time excluded; token/cost caps unchanged | `mvn test` |
| NFR3 | Agent + Backend | config tests; migration rollback | flag off matches Phase 1; migration additive | `mvn test`, `npm test` |
| NFR4 | Backend | `ticketQuestionService.test.js`, `notificationService.test.js` | credential-shaped text never stored/returned | `npm test` |
| NFR5 | CI | coverage run | backend/frontend coverage ≥ 60% | `npm run test:coverage`, `npm test -- --run --coverage` |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] OpenAPI/types regenerated and the contract test passes
- [ ] No secret, `.env`, `Jenkinsfile` or unrelated file touched
- [ ] Flag-off behavior is byte-for-byte the Phase 1 path
- [ ] `04` matches what was actually built

## Dependencies

- fg-30 Phase 1, fg-33, fg-41, fg-42 and fg-54 (all merged).
- Pinned OpenCode 1.19.5 question/reply endpoint (known unknown 1).

## Risks and edge cases

1. **OpenCode reply contract** — verify before building the bridge; if the
   pinned version cannot accept a reply, stop and keep the flag off.
2. **Blocking prompt** — confirm the prompt call survives a question; if not,
   switch to the non-blocking message API before implementing.
3. **Active-run queries** — keep `status='running'`; do not add a new status.
4. **Lease/reaper** — a waiting run must keep a fresh heartbeat; a dead
   supervisor must still be reaped.
5. **Notification fanout** — dedupe recipients; do not notify users without
   project access.
6. **Redaction** — question text is model-generated and may contain repo
   content; redact before storing and never log the raw answer.

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `c953174` (PR #195) | backend 152/1781, integration 19/139, agent 920 (10 skipped), frontend 68/589 + typecheck, ESLint, `planning/check-planning.js` | Implemented the opt-in question loop: migration 060, question/notification services and routes, OpenCode config/flag, question bridge, budget pause/resume, doom-loop detector, recovery expiry, bell/inbox/ticket card. `HARNESS_QUESTION_LOOP` defaults off, so flag-off behavior matches Phase 1. Reply endpoint assumption recorded in `04` §9; it fails closed when the pinned server does not support it. |
| — | — | — | Pilot drill in the fg-54 runbook not yet executed (staging). |
