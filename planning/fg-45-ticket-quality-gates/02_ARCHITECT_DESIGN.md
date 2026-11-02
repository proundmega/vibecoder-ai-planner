# 02_ARCHITECT_DESIGN.md - Ticket Quality Gates and Definition of Ready (fg-45)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31/32

## Design summary

Add one readiness assertion used by every execution path, a readiness evaluator, and a service-owned approval state. The UI guides users to readiness; the backend is the source of truth.

```
Create ticket (draft: status=backlog, phase=draft)
  -> choose template / small-fix exemption
  -> apply template files
  -> fill scope + acceptance criteria
  -> POST /readiness/approve-plan
       -> validate content checks (all but approval)
       -> set plan_approved_at/by + planning_status=completed
       -> set ready_at/by only if nothing is waived/outstanding
  -> execution paths call assertReadyForExecution(ticket, target)
       -> ready: proceed
       -> not ready: 409 READINESS_FAILED + issues[]
  -> override (permission, reason, waivedCodes[], expiry, audit)
```

## Enforcement matrix (the core of this ticket)

| Path | Code | When the assertion runs |
|---|---|---|
| Agent pickup | `TicketService.pickUpTicket` | before the `UPDATE ... status='in_progress'` |
| Status endpoint | `TicketService.updateStatus` | when `status === 'in_progress'` |
| Ticket PUT | `TicketService.update` | when the payload changes `status` to `in_progress` |
| Phase transition | `PhaseService.transition` | when the target phase maps to `in_progress`, i.e. `assigned`, `in_progress`, `blocked` (`PHASE_TO_STATUS`) |
| Planning status | `TicketPlanningService.updateStatus` | rejects `completed` and any transition out of `completed` (409 `PLANNING_STATUS_FORBIDDEN` / `REPLAN_REQUIRED`); route gains `TICKET_UPDATE` |

`assertReadyForExecution` is the only gate. It **evaluates inside** the caller's transaction but **does not write** the audit row there:

```js
// services/TicketReadinessService.js
async assertReadyForExecution(ticketId, { toStatus, toPhase, source, actor, attemptId }) {
  const mode = process.env.READINESS_GATE_MODE || 'warn';   // off | warn | enforce
  if (mode === 'off') return { ready: true, skipped: true, mode };

  const result = await this.evaluate(ticketId);
  if (result.ready) return { ...result, mode };

  const blocked = {
    ...result,
    mode,
    blocked: true,
    attemptId: attemptId ?? randomUUID(),   // generated once, carried to the event
    source,
    actor,
  };
  if (mode === 'enforce') throw new ReadinessError(blocked);
  return blocked;                            // warn: caller proceeds and emits after COMMIT
}
```

Persistence happens **after the transaction ends**, never inside it:

```js
// warn mode — allow the transition, then audit
const readiness = await readinessService.assertReadyForExecution(...);
await client.query('COMMIT');
if (readiness.blocked) await readinessService.emitBlocked(readiness); // separate connection

// enforce mode — roll back first, then audit
try {
  await readinessService.assertReadyForExecution(...);   // throws ReadinessError
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  if (err instanceof ReadinessError) await readinessService.emitBlocked(err.result);
  throw err;
}
```

Why: `ticket_readiness_events.ticket_id REFERENCES tickets(id)` makes Postgres take `FOR KEY SHARE` on the parent ticket row for the insert. The caller already holds that row with `SELECT ... FOR UPDATE`, so an in-transaction insert blocks until the statement timeout (or deadlocks). Emitting after `COMMIT` (warn) or after `ROLLBACK` (enforce) also means the rejected transaction cannot delete the row. `emitBlocked` is idempotent on `attempt_id`, so a retried request cannot duplicate the event; the HTTP error handler does **not** write a second row.

`emitBlocked` uses a pooled connection acquired outside the caller's transaction.

Rules:

- Only `enforce` blocks. `warn` (the default) records the attempt and allows the transition, so rollout does not freeze the board. `off` skips evaluation entirely.
- The assertion is skipped for grandfathered tickets (`readiness_grandfathered_at IS NOT NULL`).
- It runs for humans and agents alike; permissions never imply readiness.
- `PUT /tickets/:id` only gates status changes into `in_progress`; editing title/description/template is allowed while unready.
- `PhaseService.transition` evaluates the **target**, not the source: `review -> in_progress` (fg-32 fix dispatch) and `done -> in_progress` (reopen) are gated too.
- Postgres row locking: the assertion runs inside the same transaction as the status write (`SELECT ... FOR UPDATE`) so a concurrent edit cannot flip readiness between check and update. The **blocked audit row is not** written in that transaction.

## ready_at lifecycle

`ready_at` is a cache of the evaluator, not an independent truth. It is refreshed by `refreshReadyState(ticketId, actor)`:

```
evaluate -> ready ? set ready_at=NOW(), ready_by=actor : set ready_at=NULL
```

Called from every readiness-relevant write:

| Write | Effect |
|---|---|
| `PUT /tickets/:id` title/description change | clear + re-evaluate |
| planning file upsert/delete (`PUT/DELETE /planning/:fileKey`) | clear + re-evaluate |
| `apply-template` | clear + re-evaluate |
| acceptance-criteria create/update/delete | clear + re-evaluate |
| small-fix created | clear + re-evaluate |
| override granted/revoked | clear + re-evaluate |
| `approve-plan` | validate, then set `plan_approved_at` and re-evaluate |

Waiver expiry is handled by two mechanisms:

1. `assertReadyForExecution` always re-evaluates, so an expired waiver can never allow execution even if `ready_at` is stale.
2. An hourly `READINESS_SWEEP_INTERVAL_MINUTES` sweep selects `ready_at IS NOT NULL AND readiness_override_expires_at <= NOW()`, calls `refreshReadyState`, and writes one `override_expired` event per expiring waiver.

`GET /readiness` is read-only and never persists; it returns the computed state. The sweep bounds how long `ready_at` can disagree with the evaluator (one interval), and `deriveStage` trusts `ready_at` only because of that contract. A content edit that leaves the ticket ready re-sets `ready_at` in the same request, so the flow view and the gate do not diverge.

## Data model

```sql
ALTER TABLE tickets ADD COLUMN plan_approved_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN plan_approved_by BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN ready_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN ready_by BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN small_fix_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN small_fix_by BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN small_fix_reason TEXT;
ALTER TABLE tickets ADD COLUMN readiness_override_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN readiness_override_by BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN readiness_override_reason TEXT;
ALTER TABLE tickets ADD COLUMN readiness_waived_codes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN readiness_override_expires_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN readiness_grandfathered_at TIMESTAMPTZ;

CREATE TABLE ticket_acceptance_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id)
);

CREATE TABLE ticket_readiness_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,          -- approved|replan_started|small_fix|override_granted|override_revoked|override_expired|blocked
  attempt_id UUID UNIQUE,               -- set for blocked rows; dedupes retries
  actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_user_id BIGINT REFERENCES users(id),   -- user actor, or the agent's owner
  actor_agent_id BIGINT REFERENCES agents(id), -- set when actor_type='agent'
  actor_role VARCHAR(32),
  reason TEXT,
  waived_codes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_readiness_events_ticket ON ticket_readiness_events(ticket_id, created_at DESC);
CREATE INDEX idx_acceptance_ticket ON ticket_acceptance_criteria(ticket_id, position);
```

Why not `audit_log`: it is referenced by dead code but was never created (bp-124 O2). This ticket ships real tables with a rollback; if bp-124 later adds a generic audit log, `ticket_readiness_events` can be projected into it.

### Actor identity and rollback safety

- Agent auth sets `req.user.id = agent.id` (the `agents.id` row) and `req.user.userId = agent.owner_id` (`middleware/auth.js:300-305`). An agent ID is **not** a `users.id`, so the event table cannot use a single `actor_id` FK to `users`.
- Write `actor_type='agent'`, `actor_agent_id=req.user.id`, `actor_user_id=req.user.userId`, `actor_role=req.user.role`. Human actions use `actor_type='user'` + `actor_user_id`. Scheduled work uses `actor_type='system'`.
- `blocked` events are emitted **after** the status transaction ends (after `COMMIT` in `warn`, after `ROLLBACK` in `enforce`) by `emitBlocked`: a metric, a structured log, and one `ticket_readiness_events` row on a separate pooled connection (best-effort, `attempt_id`-guarded). Writing earlier would take `FOR KEY SHARE` on the ticket row already locked `FOR UPDATE` by the caller, which blocks or deadlocks. The error handler does not write a second row, so enforce-mode blocks are not duplicated and warn-mode blocks are still audited even though the transition succeeds.
- `DELETE /readiness/override` writes `override_revoked`; the sweep writes `override_expired` once per waiver (guarded by `expires_at` + existing event check).

## State machine

```
planning_status: not_started -> template_selected -> in_progress
                                                   |
                                     approve-plan  v
                            plan_approved_at/by + planning_status=completed
                                                   |
                                     ready_at/by (only if clean)
                                                   |
                          replan (explicit, audited) v
                            clears plan_approved_at + ready_at
                            planning_status=in_progress
```

- `plan_approved_at` is the approval fact; `planning_status` mirrors it for existing UI reads and for the legacy `PhaseService.getGateStatus()`.
- The evaluator checks `plan_approved_at IS NOT NULL` (condition 8), **not** `planning_status`.
- `ready_at` is set atomically by the approval endpoint, or by a later re-evaluation after edits.
- **`completed` is sticky.** Planning-file upsert and `apply-template` must not regress it to `in_progress`/`template_selected` while `plan_approved_at` is set. Those two writes keep `planning_status='completed'` and only refresh `ready_at`. `PATCH /planning/status` is different: it rejects any transition out of `completed` (see below).
- To author a new plan, call `POST /tickets/:id/readiness/replan`. It clears `plan_approved_at` and `ready_at`, sets `planning_status='in_progress'`, and writes a `replan_started` audit event. `PATCH /planning/status` rejects any transition out of `completed` with 409 `REPLAN_REQUIRED`.
- Any content edit after approval clears `ready_at` (but keeps `plan_approved_at`), then `refreshReadyState` immediately re-evaluates and re-sets `ready_at` if the ticket is still clean. Re-approval is required only when content checks fail.
- Waiver expiry never leaves `ready_at` truthy for long: the expiry sweep clears it, and `assertReadyForExecution` re-evaluates regardless.
- There is no endpoint that sets `ready_at` without validating; overrides create a waiver, not a fake ready.

## Readiness evaluator

`TicketReadinessService.evaluate(ticketId)` returns:

```json
{
  "ready": false,
  "planningStatus": "completed",
  "planApproved": true,
  "template": "architecture",
  "waivedCodes": ["MISSING_ROLLBACK"],
  "overrideExpiresAt": "2026-11-15T00:00:00Z",
  "issues": [
    { "code": "DESCRIPTION_TOO_SHORT", "message": "...", "field": "description" },
    { "code": "MISSING_REQUIRED_FILE", "message": "...", "file": "02_ARCHITECT_DESIGN.md" },
    { "code": "PLACEHOLDER", "message": "...", "file": "03_ARCHITECT_IMPLEMENTATION.md", "marker": "{{DATE}}" },
    { "code": "MISSING_ACCEPTANCE_CRITERIA", "message": "..." }
  ]
}
```

### Issue codes

| Code | Check | Waivable |
|---|---|---|
| `TITLE_TOO_GENERIC` | title < 12 chars or matches `fix`, `fix stuff`, `bug`, `wip`, `misc`, `updates` | yes |
| `DESCRIPTION_TOO_SHORT` | description < 80 chars | yes |
| `MISSING_SCOPE` | no in/out-of-scope section in the template or description | yes |
| `MISSING_TEMPLATE` | no template and no valid small-fix exemption | no (small-fix path instead) |
| `MISSING_REQUIRED_FILE` | template declares a required file that is absent | no (small-fix path instead) |
| `EMPTY_REQUIRED_FILE` | required file exists but is whitespace-only | no (small-fix path instead) |
| `MISSING_REQUIRED_SECTION` | a `requiredSections` heading is absent or empty | yes |
| `PLACEHOLDER` | `{{...}}`, `TBD`, `TODO`, `FIXME` in a required file | yes |
| `MISSING_ACCEPTANCE_CRITERIA` | `ticket_acceptance_criteria` is empty | yes |
| `PLAN_NOT_APPROVED` | `plan_approved_at IS NULL` | no |
| `MISSING_TEST_PLAN` | non-small template without a test/verification section | yes |
| `MISSING_DEPENDENCIES` | non-small template without a dependencies section | yes |
| `MISSING_ROLLBACK` | non-small template without rollback/risk | yes |

`waivedCodes` matches issue codes exactly. An expired waiver is ignored (not deleted) and the issues reappear.

## Template schema (no more guessing)

`file_definitions` gains optional section metadata:

```json
{
  "key": "04_SPECIFICATION.md",
  "title": "Specification",
  "required": true,
  "requiredSections": ["Scope", "Acceptance Criteria", "Test-First Requirement", "Out of Scope"]
}
```

- `TemplateService` gets `requiredSections` on the built-in architect/technical/simple/specification definitions, and `GET /templates/:name` returns it.
- Custom project templates may omit `requiredSections`; the evaluator then only enforces file presence/non-emptiness and placeholders, and the readiness response reports `sectionsEnforced: false`.
- Acceptance criteria: the `ticket_acceptance_criteria` table is authoritative. `apply-template` seeds it from a `## Acceptance Criteria` list if the table is empty; later edits go through the criteria endpoints, not free text.

## API

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/tickets/:id/readiness` | Evaluate and return issues | `TICKET_READ` |
| POST | `/tickets/:id/readiness/approve-plan` | Validate content, record approval, set `ready_at` when clean | `TICKET_READINESS_APPROVE` |
| POST | `/tickets/:id/readiness/small-fix` | Record a template/file/section exemption | `TICKET_READINESS_OVERRIDE` |
| POST | `/tickets/:id/readiness/replan` | Clear approval/ready and reopen planning | `TICKET_READINESS_APPROVE` |
| POST | `/tickets/:id/readiness/override` | Waive codes with reason + expiry | `TICKET_READINESS_OVERRIDE` |
| DELETE | `/tickets/:id/readiness/override` | Revoke a waiver | `TICKET_READINESS_OVERRIDE` |
| GET/POST/PUT/DELETE | `/tickets/:id/acceptance-criteria` | Manage criteria (POST accepts an array) | `TICKET_UPDATE` |

Permissions are seeded in a migration:

- `TICKET_READINESS_APPROVE` → `project_admin`, `super_admin`
- `TICKET_READINESS_OVERRIDE` → `project_admin`, `super_admin`

Both checks also require project membership via the shared helper below. `requireAnyPermission` matches **permission codes**, not role names; do not pass `'PROJECT_ADMIN'` (it is not a seeded permission).

### Project membership helper

There is no project-membership enforcement today: `ProjectService.getOne` ignores `_userId` (`ProjectService.js:11-15`), `Ticket.findByProject` ignores `_uid` (`models/ticket.js:42-52`), and the only ownership check is the assignee validation in `TicketService.js:84-89`. Without a helper, a global `project_admin` could approve or override any project.

Add `backend/src/services/ProjectAccessService.js`:

```js
// Returns true when the user is the project owner or a project member.
// Agent actors pass req.user.userId (the agent's owner), so no agent row is needed.
async isProjectMember(userId, projectId) {
  // 1) projects.owner_id = userId
  // 2) project_memberships (project_id, user_id) = (projectId, userId)
}

async assertProjectMember(userId, projectId, { role, allowSuperAdmin = true } = {}) {
  if (allowSuperAdmin && role === 'super_admin') return;
  if (!await this.isProjectMember(userId, projectId)) throw new ForbiddenError('Not a project member');
}
```

- Use `req.user.userId` (the agent owner), not `req.user.id`, when the actor is an agent.
- Call `assertProjectMember` from `approve-plan`, `small-fix`, `replan`, `override` (and `DELETE`) after resolving the ticket's `project_id`.
- `super_admin` is the only explicit bypass; project admins must still be project members.
- This ticket scopes the check to readiness routes. Retrofitting `ProjectService.getOne`/`Ticket.findByProject` is a follow-up (recorded in Pending Scope).

`approve-plan` transaction:

1. `SELECT ... FOR UPDATE` the ticket.
2. Evaluate content checks 1-7 and 9.
3. If issues remain **outside** the waiver set → 409 `READINESS_FAILED`.
4. Set `plan_approved_at/by`, `planning_status='completed'`.
5. If no non-waived issues → set `ready_at/by`.
6. Insert `ticket_readiness_events` (`action='approved'`, before/after).
7. Commit.

## Error contract

```json
{
  "success": false,
  "error": {
    "code": "READINESS_FAILED",
    "message": "Ticket is not ready",
    "details": {
      "issues": [{ "code": "DESCRIPTION_TOO_SHORT", "message": "...", "field": "description" }],
      "waivedCodes": ["MISSING_ROLLBACK"]
    }
  }
}
```

- New `ReadinessError extends AppError` with `statusCode = 409`, `code = 'READINESS_FAILED'`, `details.issues`, and a `result` property carrying `{ issues, waivedCodes, mode, attemptId, source, actor }`. `result` is what `emitBlocked` persists after rollback; it is also what the HTTP handler serializes (minus actor/attempt internals).
- `ValidationError` stays 400/`VALIDATION_ERROR`; readiness must not reuse it.
- Java: `ApiResponse.Error` gains `details` (map/JsonNode); add `ReadinessIssue`. `ApiService` throws `ReadinessException` carrying the issues instead of a generic `IOException`.
- `ReadinessException` is handled in **both** `TicketProcessor.processTicket` (`TicketProcessor.java:80`) and `HarnessTicketProcessor.processTicket` (`HarnessTicketProcessor.java:147`): post a `status` message with the codes, call `releaseTicket`, return without cloning or starting the harness, and log `readiness_blocked`.

## UI

### Create ticket wizard

1. Project, title, priority.
2. Description with minimum length hint.
3. Template selector (architecture/technical/simple/custom) or “Small fix” checkbox + reason.
4. Acceptance criteria (repeatable rows → `ticket_acceptance_criteria`).
5. “Create draft” or “Create + apply template”. Creation never fails for readiness, but validation errors (bad project, title length) must be shown: `createTicket` currently does `.catch(() => null)`, which hides them. Return a result object or rethrow.

### Ticket detail and board

- Readiness panel: badge, issues with links to the relevant planning file, `sectionsEnforced` note.
- Actions: Apply template, Add criteria, “Approve plan”, “Small fix”, “Override…”, “Replan” (clears approval, audited).
- Override dialog requires a reason, one or more codes, and an expiry date.
- Planning status control cannot select `completed` and is read-only once approved; show “Completed is set by Approve plan” and offer “Replan” to reopen it.
- `frontend/src/api/tickets.ts` functions must surface errors (throw or return a result object); remove `.catch(() => null)` for `updateTicket` so the 409 reaches the view.
- `TicketBoard.handleDrop` (`frontend/src/views/TicketBoard.vue:76-84`) currently logs and ignores the failure. On 409 `READINESS_FAILED` it must restore the card's previous column and show the issue list (toast/banner), not silently leave the optimistic state.
- Both the detail view and the board render the same `ReadinessIssues` component, so codes/messages stay consistent.

## Rollout and backfill

1. **Ship schema + evaluator + API** with `READINESS_GATE_MODE=warn` (the default; `off|warn|enforce`). Note that `warn` does **not** block, so acceptance #1 (“cannot be picked up”) holds only once `enforce` is enabled.
2. **Grandfather backfill** (same migration):
   - existing `in_progress`, `review`, `done` tickets get `readiness_grandfathered_at = updated_at`, `ready_at = updated_at`, `plan_approved_at = updated_at`, and `planning_status='completed'` when null.
   - Because the evaluator checks `plan_approved_at` (not `planning_status`) and skips grandfathered rows, backfilled tickets stay claimable.
3. `warn`: log/metric blocked attempts, allow them.
4. `enforce` for new tickets once the blocked rate is understood.
5. Triage `backlog` tickets into drafts/templates via the readiness panel.
6. Enable phase-transition gating (same assertion, already in the matrix).
7. Start the expiry sweep (`READINESS_SWEEP_INTERVAL_MINUTES`, default 60) before enabling overrides.

Rollback: delete the readiness routes and set `READINESS_GATE_MODE=off`; the columns are additive and the migration has a `_rollback.sql`.

## Metrics

- `tickets_ready_total`, `tickets_blocked_by_readiness_total{code,source}`
- readiness rate by project (ready / backlog)
- `time_to_ready_seconds` (created_at → ready_at, p50/p95)
- `readiness_override_total{code}` and waiver expiry count
- agent pickups rejected by readiness, split by processor

## Tests

- evaluator returns each issue code, including `sectionsEnforced: false` for custom templates;
- all three `READINESS_GATE_MODE` values: `off` skips, `warn` records + allows, `enforce` throws;
- `assertReadyForExecution` is invoked by pickup, `updateStatus`, `update` (status changes only), and phase transitions to `assigned`/`in_progress`/`blocked`;
- `PATCH /planning/status` returns 409 `PLANNING_STATUS_FORBIDDEN` for `completed`, 409 `REPLAN_REQUIRED` for `completed -> in_progress`, and 200 for the other states;
- `apply-template` and planning-file upsert after approval keep `planning_status='completed'` and refresh `ready_at`;
- `POST /readiness/replan` clears `plan_approved_at`/`ready_at`, sets `in_progress`, and writes `replan_started`;
- `approve-plan` on an incomplete ticket sets neither `completed` nor `ready_at`;
- approve → edit → readiness false again; edit → still-ready → `ready_at` re-set in the same request;
- waiver expiry: assertion re-blocks immediately, the sweep clears `ready_at` and writes `override_expired`;
- override is permission-checked, project-scoped, code-scoped, expiring; expired waiver re-blocks; unlisted codes still block; revocation writes `override_revoked`;
- `assertProjectMember`: owner passes, `project_memberships` passes, non-member 403, `super_admin` bypasses, agent actors use the owner ID; enforced on approve-plan, small-fix, replan and override;
- small-fix exemption waives `MISSING_TEMPLATE`/`MISSING_REQUIRED_FILE`/`EMPTY_REQUIRED_FILE`/`MISSING_REQUIRED_SECTION`, still enforces title/description/scope/criteria/placeholders, and marks test/dependency/rollback codes not applicable;
- blocked audit rows are emitted after `COMMIT` (warn) / `ROLLBACK` (enforce), exactly once, and do not hit the `FOR UPDATE` FK lock;
- agent actors store `actor_agent_id` without an FK violation;
- both Java processors post issues, release, and start no harness;
- grandfathered backfill keeps tickets claimable;
- frontend `updateTicket`/`createTicket` propagate errors; TicketDetail **and** TicketBoard render readiness issues.

## Open questions

1. Minimum description length (proposal: 80 characters) needs product confirmation.
2. Should `member` ever hold `TICKET_READINESS_OVERRIDE`? Phase 1: no.
3. Do custom templates require `requiredSections`, or stay presence-only? Phase 1: presence-only with a visible warning.
4. Should `ready_at` be cleared automatically on any planning-file edit, or on the next evaluation? Phase 1: clear on write, recompute on read.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | AI-assisted plan drafting | Agent / UX | `fg-30` Phase 2 | No |
| 2 | fg-46 | Readiness/blocked metrics | Observability | `fg-46-flow-observability` | No |
| 3 | fg-37 | Readiness vs quality metrics | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-31 | Reviewer readiness checks | Review | `fg-31` follow-up | No |
| 5 | fg-45 | Enforce project membership in `ProjectService.getOne`/`Ticket.findByProject` (they currently ignore `userId`) | Security | `bp-124` follow-up | No |
