# 04 — Specification (fg-55)

> **Owns:** exact file operations, signatures and contracts.
> **Not here:** design rationale (`02`), requirements (`01`), verification
> matrix (`03`), status (`00`).

Execution order: test stubs first, then migration, services, routes, agent,
frontend, docs. Do not create production code before its stub exists.

## Test-First Requirement

Create the ten stub files listed in `03` → Test-First Requirement **before**
any production file. Each stub starts with imports, a `describe` block and
`it.todo`/`@Test` placeholders; fill them in after the production code exists.
The first file operation in this ticket is
`backend/src/__tests__/ticketQuestionService.test.js`.

## 1. Test stubs

| File | Initial contents |
|---|---|
| `backend/src/__tests__/ticketQuestionService.test.js` | imports + `describe` + `it.todo` for create/dedupe/answer/expire/timeout |
| `backend/src/__tests__/notificationService.test.js` | fanout, count, read, rollback |
| `backend/src/__tests__/api-questions.test.js` | agent create/read/expire, member answer, 403/404/409 |
| `backend/src/__tests__/integration/ticketQuestionsNotifications.test.js` | real Postgres migration + service round trip |
| `agent/src/test/java/com/vibecode/agent/harness/QuestionBridgeTest.java` | fake OpenCode server question → answer → resume |
| `agent/src/test/java/com/vibecode/agent/harness/DoomLoopDetectorTest.java` | signature counting, continue/reset, cap |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessBudgetTrackerQuestionTest.java` | pause/resume excludes wait |
| `frontend/src/__tests__/notificationBell.test.ts` | unread count, polling, mark read |
| `frontend/src/__tests__/questionInbox.test.ts` | pending filter, answer submit, error |
| `frontend/cypress/component/QuestionCard.cy.ts` | card render + answer |

## 2. Migration 060

File: `backend/src/migrations/060_ticket_questions_notifications.sql`
(+ `_rollback.sql`), registered in `apply.js` after 059.

```sql
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waited_ms BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ticket_questions (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  runtime_id BIGINT NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  external_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('question','permission','doom_loop')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','answered','expired','cancelled')),
  prompt TEXT NOT NULL,
  options JSONB,
  answer TEXT,
  answered_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_questions_external
  ON ticket_questions(run_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_questions_run_status
  ON ticket_questions(run_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_questions_project_status
  ON ticket_questions(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  run_id UUID REFERENCES harness_runs(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES ticket_questions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN
    ('question','run_succeeded','run_failed','budget_exceeded')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
```

Rollback drops the tables and the two columns.

## 3. Service signatures

`backend/src/services/TicketQuestionService.js`:

```js
createForRun({ runId, runtimeId, externalId, kind, prompt, options, expiresAt })
getForRun(runId, questionId)
listForProject(projectId, { status, limit, offset })
answer(runId, questionId, { answer, userId })
expire(runId, questionId)
expirePendingForRun(runId, reason)
```

`backend/src/services/NotificationService.js`:

```js
createForQuestion(question, { recipients })
createForRunFinish(run, { type, payload })
listForUser(userId, { unread, limit, offset })
unreadCount(userId)
markRead(userId, notificationId)
markAllRead(userId)
markQuestionRead(userId, questionId)
```

`HarnessRunService` additions:

```js
markWaiting(runId)        // waiting_since = NOW()
clearWaiting(runId)       // waited_ms += now - waiting_since; waiting_since = NULL
```

## 4. API contracts

Standard envelope: `{ success: true, data }` or
`{ success: false, error: { code, message } }`.

### Agent (node token + `X-Agent-Runtime`)

`POST /api/v1/harness/runs/:runId/questions`

```json
{ "kind": "question", "externalId": "evt_123", "prompt": "...", "options": [{"label":"A","value":"a"}], "expiresAt": "2026-11-22T12:00:00Z" }
```

`201`:

```json
{ "success": true, "data": { "id": 7, "status": "pending", "expiresAt": "..." } }
```

`GET /api/v1/harness/runs/:runId/questions/:questionId` → `{ status, answer, answeredAt }`.

`POST .../expire` → `{ status: "expired" }` (idempotent).

### User (JWT)

`POST /api/v1/harness/runs/:runId/questions/:questionId/answer`

```json
{ "answer": "Use the existing helper in src/lib/foo.ts." }
```

`200` → `{ id, status: "answered", answeredAt }`.

`GET /api/v1/notifications/unread-count` → `{ count: 3 }`.

`POST /api/v1/notifications/:id/read` → `200`.

## 5. Agent

- `HarnessConfig`: `HARNESS_QUESTION_LOOP` (boolean, default false),
  `HARNESS_QUESTION_TIMEOUT_MINUTES` (default 60),
  `HARNESS_QUESTION_POLL_SECONDS` (default 5),
  `HARNESS_DOOM_LOOP_MAX` (default 3),
  `HARNESS_DOOM_LOOP_CONTINUES` (default 3).
- `OpenCodeConfigWriter`: `question` = `allow` iff the flag is on;
  `doom_loop` stays `deny`.
- `OpenCodeClient`: parse question/permission events, expose
  `replyToQuestion(sessionId, questionId, answer)` and
  `rejectQuestion(sessionId, questionId)`. Read the exact endpoint from the
  pinned server's `/doc` at startup; fail closed if absent.
- `HarnessTicketProcessor`: wait/poll/resume/timeout; emit
  `question.asked|answered|timeout`; on restart, expire pending questions and
  fail/release.
- `HarnessBudgetTracker`: `pause()`/`resume()`; active time excludes the wait;
  report `waitedMs` at finish.
- `DoomLoopDetector`: signature = `sha256(tool + "\n" + canonicalJson(args))`;
  count consecutive equal signatures; escalate at the cap.

## 6. Frontend

- `NotificationBell.vue`: props none; uses `notifications.ts`; badge; dropdown;
  `visibilitychange` pauses polling.
- `QuestionInbox.vue`: route `/questions`; project filter; answer textarea;
  submit; optimistic read.
- `TicketQuestionCard.vue`: props `ticketId`; shows the latest pending question;
  emits `answered`.
- `validator.ts`: add question/notification response guards.
- `api-contract.test.ts`: assert the new routes are in the generated spec.

## 7. Docs

- `agent/README.md`: add the five env vars to the supervisor env table.
- `AGENTS.md`: add the `HARNESS_QUESTION_*`/`HARNESS_DOOM_LOOP_*` vars to the
  harness section.
- `planning/DONE/fg-54-agent-fleet/05_RUNBOOK.md`: add a question drill.
- `PENDING.txt` / `HARNESS_ROADMAP.md`: set fg-55 status as it moves.

## 8. Verification commands

```bash
cd backend && npm test -- --runInBand
cd backend && npm run test:integration
cd backend && npm run lint
cd agent && mvn test
cd frontend && npm test -- --run
cd frontend && npm run typecheck
cd frontend && npm run lint
node planning/check-planning.js
```

## 9. Implementation notes (2026-11-22)

These are the deltas from the planned contract; the design in `02` and the
requirements in `01` remain the source of truth.

- **OpenCode reply contract.** `OpenCodeClient.replyToQuestion` posts a
  question to `POST /session/{sessionId}/questions/{requestId}/reply` and a
  permission to `POST /session/{sessionId}/permissions/{requestId}`. This is
  the pinned-version assumption from known unknown 1. A 404/unsupported reply
  path throws and fails the run (`question_resume_failed`); it never fakes a
  resume.
- **Extra read routes for the UI.** `GET /harness/tickets/:ticketId/questions`
  feeds the ticket card and `GET /harness/questions` feeds the cross-project
  inbox. Both reuse the same service listing and project-membership checks.
- **Question creation transaction.** `TicketQuestionService.createForRun`
  locks the run row, verifies it belongs to the calling runtime, inserts the
  question, sets `waiting_since` and fans out notifications on the same client.
  A notification failure rolls the question back.
- **Finish transaction.** `HarnessRunService.finishRun` now clears
  `waiting_since`, adds `waited_ms`, expires pending questions and inserts
  per-recipient notifications in one data-modifying CTE, so a finish cannot
  leave a pending question or a partial fanout.
- **Recovery.** `recoverRun` treats `waiting_since` as non-fresh even when the
  heartbeat is current, expires the run with `question_timeout` and releases
  the ticket. Durable suspend/resume remains D3.
- **Doom loop.** `DoomLoopDetector` lives in the supervisor; `doom_loop`
  remains denied in the generated OpenCode config. The detector hashes
  `tool + canonical JSON(args)` with SHA-256 and counts consecutive matches.
- **Reply path fail-closed.** If the OpenCode event has no request id, the
  bridge uses a generated external id for dedupe and the reply fails closed
  instead of guessing a session id.
- **Permission answers.** Permission requests map `allow`/`yes` to `once`,
  `always` to `always`, and `reject`/`no`/anything unrecognised to `reject`;
  free text can never approve. The ticket card and inbox render Allow/Always
  allow/Reject (and Continue/Abort for doom loops) instead of a text box.
- **Agent read isolation.** An agent may read a question only when
  `question.runtime_id` equals its `X-Agent-Runtime`; the run-list route checks
  the run's runtime before listing, so a same-project worker cannot read a
  sibling's question by UUID. A JWT list call is project-scoped with
  `ANSWER_PERMISSION`, so an outsider who knows the run UUID gets 403.
- **Repetition counting.** The doom-loop detector ignores OpenCode lifecycle
  updates by tracking unique `callId`s, so one running/completed pair is one
  call, not two repeats.
- **Inbox audience.** The cross-project inbox query requires project ownership
  or a membership role carrying `AGENT_READ`, matching the answer permission.
- **Bell on public routes.** The bell calls no authenticated endpoint and starts
  no poll without a token, so the authenticated shell mounting briefly before
  `/register`/`/login` resolves cannot trigger a 401 logout.
