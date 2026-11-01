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
| Planning status | `TicketPlanningService.updateStatus` | rejects `completed` outright (409 `PLANNING_STATUS_FORBIDDEN`); route gains `TICKET_UPDATE` |

`assertReadyForExecution` is the only gate:

```js
// services/TicketReadinessService.js
async assertReadyForExecution(ticketId, { toStatus, toPhase, source, actor }) {
  const result = await this.evaluate(ticketId);
  if (result.ready) return result;
  throw new ReadinessError(result);   // 409 READINESS_FAILED, details.issues
}
```

Rules:

- The assertion is skipped for grandfathered tickets (`readiness_grandfathered_at IS NOT NULL`).
- It runs for humans and agents alike; permissions never imply readiness.
- `PUT /tickets/:id` only gates status changes into `in_progress`; editing title/description/template is allowed while unready.
- `PhaseService.transition` evaluates the **target**, not the source: `review -> in_progress` (fg-32 fix dispatch) and `done -> in_progress` (reopen) are gated too.
- Postgres row locking: the assertion runs inside the same transaction as the status write (`SELECT ... FOR UPDATE`) so a concurrent edit cannot flip readiness between check and update.

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
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id)
);

CREATE TABLE ticket_readiness_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,          -- approved | small_fix | override | blocked
  actor_id BIGINT REFERENCES users(id),
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

Why not `audit_log`: it is referenced by dead code but was never created (bp-124 O2). This ticket ships a real table with a rollback; if bp-124 later adds a generic audit log, `ticket_readiness_events` can be projected into it.

## State machine

```
planning_status: not_started -> template_selected -> in_progress
                                                   |
                                     approve-plan  v
                            plan_approved_at/by + planning_status=completed
                                                   |
                                     ready_at/by (only if clean)
```

- `plan_approved_at` is the approval fact; `planning_status` mirrors it for existing UI reads.
- The evaluator checks `plan_approved_at IS NOT NULL` (condition 8), **not** `planning_status`.
- `ready_at` is set atomically by the approval endpoint, or by a later re-evaluation after edits (a background/save hook may clear it).
- Any content edit after approval clears `ready_at` (but keeps `plan_approved_at`); the next evaluation decides whether re-approval is needed. Re-approval is required only when content checks fail.
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
| POST | `/tickets/:id/readiness/small-fix` | Record a template/file exemption | `TICKET_READINESS_OVERRIDE` |
| POST | `/tickets/:id/readiness/override` | Waive codes with reason + expiry | `TICKET_READINESS_OVERRIDE` |
| DELETE | `/tickets/:id/readiness/override` | Revoke a waiver | `TICKET_READINESS_OVERRIDE` |
| GET/POST/PUT/DELETE | `/tickets/:id/acceptance-criteria` | Manage criteria (POST accepts an array) | `TICKET_UPDATE` |

Permissions are seeded in a migration:

- `TICKET_READINESS_APPROVE` → `project_admin`, `super_admin`
- `TICKET_READINESS_OVERRIDE` → `project_admin`, `super_admin`

Both checks also require project membership (`req.user` owns or belongs to the project). `requireAnyPermission` matches **permission codes**, not role names; do not pass `'PROJECT_ADMIN'` (it is not a seeded permission).

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

- New `ReadinessError extends AppError` with `statusCode = 409`, `code = 'READINESS_FAILED'`, `details.issues`.
- `ValidationError` stays 400/`VALIDATION_ERROR`; readiness must not reuse it.
- Java: `ApiResponse.Error` gains `details` (map/JsonNode); add `ReadinessIssue`. `ApiService` throws `ReadinessException` carrying the issues instead of a generic `IOException`.
- `ReadinessException` is handled in **both** `TicketProcessor.processTicket` (`TicketProcessor.java:80`) and `HarnessTicketProcessor.processTicket` (`HarnessTicketProcessor.java:147`): post a `status` message with the codes, call `releaseTicket`, return without cloning or starting the harness, and log `readiness_blocked`.

## UI

### Create ticket wizard

1. Project, title, priority.
2. Description with minimum length hint.
3. Template selector (architecture/technical/simple/custom) or “Small fix” checkbox + reason.
4. Acceptance criteria (repeatable rows → `ticket_acceptance_criteria`).
5. “Create draft” or “Create + apply template”. Creation never fails for readiness.

### Ticket detail

- Readiness panel: badge, issues with links to the relevant planning file, `sectionsEnforced` note.
- Actions: Apply template, Add criteria, “Approve plan”, “Small fix”, “Override…”.
- Override dialog requires a reason, one or more codes, and an expiry date.
- Planning status control cannot select `completed`; show “Completed is set by Approve plan”.
- `frontend/src/api/tickets.ts` functions must surface errors (throw or return a result object); remove `.catch(() => null)` for `updateTicket` so the 409 reaches the view.

## Rollout and backfill

1. **Ship schema + evaluator + API with the gate off** (`READINESS_GATE_MODE=off|warn|enforce`, default `warn`).
2. **Grandfather backfill** (same migration):
   - existing `in_progress`, `review`, `done` tickets get `readiness_grandfathered_at = updated_at`, `ready_at = updated_at`, `plan_approved_at = updated_at`, and `planning_status='completed'` when null.
   - Because the evaluator checks `plan_approved_at` (not `planning_status`) and skips grandfathered rows, backfilled tickets stay claimable.
3. `warn`: log/metric blocked attempts, allow them.
4. `enforce` for new tickets once the blocked rate is understood.
5. Triage `backlog` tickets into drafts/templates via the readiness panel.
6. Enable phase-transition gating (same assertion, already in the matrix).

Rollback: delete the readiness routes and set `READINESS_GATE_MODE=off`; the columns are additive and the migration has a `_rollback.sql`.

## Metrics

- `tickets_ready_total`, `tickets_blocked_by_readiness_total{code,source}`
- readiness rate by project (ready / backlog)
- `time_to_ready_seconds` (created_at → ready_at, p50/p95)
- `readiness_override_total{code}` and waiver expiry count
- agent pickups rejected by readiness, split by processor

## Tests

- evaluator returns each issue code, including `sectionsEnforced: false` for custom templates;
- `assertReadyForExecution` is invoked by pickup, `updateStatus`, `update` (status changes only), and phase transitions to `assigned`/`in_progress`/`blocked`;
- `PATCH /planning/status` returns 409 `PLANNING_STATUS_FORBIDDEN` for `completed` and 200 for the other states;
- `approve-plan` on an incomplete ticket sets neither `completed` nor `ready_at`;
- approve → edit → readiness false again;
- override is permission-checked, project-scoped, code-scoped, expiring; expired waiver re-blocks; unlisted codes still block;
- small-fix exemption waives only template/file checks, not description/criteria;
- both Java processors post issues, release, and start no harness;
- grandfathered backfill keeps tickets claimable;
- frontend `updateTicket` propagates errors and the readiness panel renders.

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
