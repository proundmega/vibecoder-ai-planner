# 02 — Design (fg-55)

> **Owns:** current-state audit, design, data flow, contracts, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file
> operations (`04`), status and deferrals (`00`).

## Current State

- `OpenCodeConfigWriter.permissions()` hardcodes `question: deny` and
  `doom_loop: deny`; `OpenCodeClient` drives one blocking prompt and has no
  question/permission handler.
- `harness_runs.status` is `running | succeeded | failed | dead_letter |
  budget_exceeded`; the unique active-run index is
  `ON harness_runs(ticket_id) WHERE status = 'running'`, and ~10 service
  queries treat `status='running'` as active.
- No `ticket_questions` or `notifications` table, service, route or UI exists.
- `HarnessBudgetTracker` meters wall-clock time; there is no pause/resume.
- `HarnessEventSink` already emits tool/step events with run/trace correlation
  (fg-41), which the doom-loop detector can consume.

## Key decision: keep the run `running` while waiting

Add `harness_runs.waiting_since TIMESTAMPTZ` and
`harness_runs.waited_ms BIGINT NOT NULL DEFAULT 0` instead of a new
`waiting_for_input` status.

Why:

- The active-run unique index and every `status='running'` query keep working;
  a second start stays blocked.
- The reaper's stuck query uses `heartbeat_at`; a waiting run with a live
  heartbeat is not reaped.
- The UI derives "waiting for input" from `waiting_since IS NOT NULL`.
- Timeout/finish use the existing `failed` transition.

Rejected alternative: a new status. It would require changing the status CHECK,
the partial unique index and every active-run query, and a missed query would
allow a duplicate run.

## Data model

### `ticket_questions` (migration 060)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `run_id` | UUID NOT NULL | FK `harness_runs(id)` ON DELETE CASCADE |
| `ticket_id` | BIGINT NOT NULL | FK `tickets(id)` ON DELETE CASCADE |
| `project_id` | BIGINT NOT NULL | FK `projects(id)` ON DELETE CASCADE |
| `runtime_id` | BIGINT NOT NULL | FK `agent_runtimes(id)` ON DELETE CASCADE |
| `external_id` | TEXT | OpenCode question/permission id, unique per run for dedupe |
| `kind` | TEXT | `question`, `permission`, `doom_loop` |
| `status` | TEXT | `pending`, `answered`, `expired`, `cancelled` |
| `prompt` | TEXT NOT NULL | redacted, max 8k |
| `options` | JSONB | optional choices |
| `answer` | TEXT | redacted, max 8k |
| `answered_by` | BIGINT | FK `users(id)` ON DELETE SET NULL |
| `answered_at` | TIMESTAMPTZ | |
| `expires_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | default NOW() |

Indexes: `(run_id, status)`, `(project_id, status, created_at DESC)`, unique
`(run_id, external_id)` where `external_id IS NOT NULL`.

### `notifications` (migration 060)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `user_id` | BIGINT NOT NULL | FK `users(id)` ON DELETE CASCADE |
| `project_id` | BIGINT | FK `projects(id)` ON DELETE CASCADE |
| `ticket_id` | BIGINT | FK `tickets(id)` ON DELETE CASCADE |
| `run_id` | UUID | FK `harness_runs(id)` ON DELETE CASCADE |
| `question_id` | BIGINT | FK `ticket_questions(id)` ON DELETE CASCADE |
| `type` | TEXT | `question`, `run_succeeded`, `run_failed`, `budget_exceeded` |
| `payload` | JSONB | redacted; short preview, PR URL, error code |
| `read_at` | TIMESTAMPTZ | null = unread |
| `created_at` | TIMESTAMPTZ | default NOW() |

Index: `(user_id, read_at, created_at DESC)`.

## API

Agent (node token + `X-Agent-Runtime`):

- `POST /api/v1/harness/runs/:runId/questions`
  `{ kind, externalId, prompt, options?, expiresAt? }` → `201 { id, status, expiresAt }`
- `GET /api/v1/harness/runs/:runId/questions/:questionId` →
  `{ status, answer, answeredAt }`
- `POST /api/v1/harness/runs/:runId/questions/:questionId/expire` → idempotent.

User (JWT):

- `GET /api/v1/projects/:projectId/questions?status=pending`
- `GET /api/v1/harness/runs/:runId/questions`
- `POST /api/v1/harness/runs/:runId/questions/:questionId/answer` `{ answer }`
- `GET /api/v1/notifications?unread=true&limit=50`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`

All responses use the standard `{ success, data }` envelope. Errors:
`QUESTION_NOT_FOUND` (404), `QUESTION_ALREADY_ANSWERED` (409),
`QUESTION_EXPIRED` (409), `FORBIDDEN` (403), `PROMPT_TOO_LONG` (400).

## Supervisor flow

1. The SSE listener sees a `question` event (or a permission request the
   profile routes to a human). Build a redacted prompt, cap it at 8k, and POST
   the question with the OpenCode event id as `external_id`.
2. Set `waiting_since=NOW()`, pause the budget tracker, emit
   `question.asked`. Keep the prompt HTTP call open; the answer is posted on a
   second connection.
3. Poll `GET .../questions/:id` every 5s. Continue the lease heartbeat every
   `HARNESS_HEARTBEAT_SECONDS`.
4. On `answered`: call the OpenCode reply endpoint for the pinned version,
   clear `waiting_since`, add the wait to `waited_ms`, resume the budget, emit
   `question.answered`, and continue the run.
5. On timeout (`HARNESS_QUESTION_TIMEOUT_MINUTES`, default 60): expire the
   question, abort/reject the OpenCode prompt, fail the run with
   `question_timeout`, destroy the sandbox and release the lease/ticket.
6. If the supervisor restarts while waiting: startup recovery expires pending
   questions and fails/releases the run. Durable resume is deferred (D3).

### Doom loop

- The supervisor computes `sha256(tool + canonical(args))` from tool events and
  counts consecutive identical signatures.
- At `HARNESS_DOOM_LOOP_MAX` (default 3), create a `doom_loop` question with
  `continue`/`abort`.
- `continue` resets the signature counter; after `HARNESS_DOOM_LOOP_CONTINUES`
  (default 3) continues, fail with `doom_loop`. `abort` fails immediately.
- Keep the OpenCode `doom_loop` permission denied. The policy is independent of
  the pinned version and survives the V2 removal of the action. Budget and
  tool-call caps remain authoritative.

## Notifications

- Question creation inserts one row per recipient in the same transaction:
  project owner plus members with `AGENT_READ`, deduplicated.
- Run finish inserts `run_succeeded` (payload includes `prUrl`),
  `run_failed` (error code) or `budget_exceeded` (usage summary).
- Payload text is redacted (fg-42) and capped; the bell shows a short preview,
  the inbox shows the full redacted prompt.
- Answering a question marks that user's question notification read.

## Frontend

- `NotificationBell.vue` in the `App.vue` navbar: unread badge, latest 10,
  link to the inbox; polls the unread count every 30s and pauses while the tab
  is hidden.
- `QuestionInbox.vue` at `/questions`: pending/answered filter, project scope,
  answer box, run/PR links.
- `TicketQuestionCard.vue` in `TicketDetail.vue`: pending question, options,
  answer box, status and timestamp.
- API clients `questions.ts` and `notifications.ts`; update `validator.ts` and
  the contract test.
- No realtime push in the MVP; polling is the contract (D2).

## Failure modes

| Case | Behavior |
|---|---|
| Duplicate question event with the same `external_id` | Return the existing row (idempotent); no second notification |
| Answer before the question is persisted | 404; the supervisor retries the create first |
| Double answer | Second answer 409 `QUESTION_ALREADY_ANSWERED` |
| Answer after timeout | 409 `QUESTION_EXPIRED`; the run is already failed |
| OpenCode session lost on resume | Fail `question_resume_failed`; no publish; release the ticket |
| Notification insert fails | The question insert rolls back; the supervisor retries and then fails closed |
| Reaper while waiting | Heartbeat is fresh, so the run is not stuck; if the supervisor dies, the reaper reclaims it |
| Prompt/answer over the cap | 400; no truncation of a stored answer |

## Security considerations

- Question/answer text is untrusted. Cap prompt and answer at 8k, store
  redacted text, render with Vue escaping (no `v-html`), and never log the raw
  answer.
- Only project members (or super_admin) can read/answer; an agent can create a
  question only for its own runtime/run; `X-Agent-Runtime` is bound to the node.
- Rate-limit answers (30/min/user) and question creation (60/min/runtime).
- The notification payload carries a short redacted preview, never a secret or
  a full diff.
- Events carry hashes/ids, not raw prompt/answer text outside the redacted
  store.
- Retention follows fg-42; notification rows inherit the project cascade.

## Alternatives considered

1. **New run status `waiting_for_input`** — rejected: touches the active-run
   index and every `status='running'` query; a missed query allows duplicates.
2. **Suspend and tear down the sandbox while waiting** — rejected for v1:
   the OpenCode session and uncommitted workspace are not durable; a restart
   would lose the run. Deferred (D3).
3. **Allow the OpenCode `doom_loop` permission** — rejected: V1-only, not a V2
   action, and it bypasses the human decision. Supervisor-side detection is
   portable and budget-aware.
4. **Email/Slack first** — rejected: the in-app bell is the chosen MVP (user
   decision 2026-11-22); channel adapters are D1.

## Rollout

1. Migration 060 (additive) and backend services/routes behind
   `HARNESS_QUESTION_LOOP=false`.
2. Agent config/flag and the question bridge; keep Phase 1 behavior when off.
3. Frontend bell/inbox/card.
4. Enable in staging, run the fg-54 pilot with a question-inducing ticket and
   the doom-loop drill; record evidence in `03`.
5. Enable by default after one clean pilot cycle; keep the kill switch and
   budgets as the safety net.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
