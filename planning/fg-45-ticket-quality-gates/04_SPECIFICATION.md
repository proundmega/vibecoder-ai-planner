# 04 — Specification (fg-45)

> **Owns:** exact file operations, signatures and contracts.
> **Not here:** design rationale (`02`), requirements (`01`), verification
> matrix (`03`), status (`00`).

Execution order: test stubs, migration, access helper, evaluator/service,
gates, routes, agent, frontend, templates, docs. Do not create production code
before its stub exists.

## 1. Test stubs

| File | Initial contents |
|---|---|
| `backend/src/__tests__/readinessEvaluator.test.js` | issue-code table, placeholders, risk sections, IDs |
| `backend/src/__tests__/ticketReadinessService.test.js` | approve/replan/override/small-fix/invalidations/sweep |
| `backend/src/__tests__/projectAccessService.test.js` | owner/member/non-member/super_admin/runtime |
| `backend/src/__tests__/readinessGate.test.js` | five paths × `off/warn/enforce` |
| `backend/src/__tests__/api-readiness.test.js` | routes, 409s, permissions, append-only |
| `backend/src/__tests__/integration/ticketReadiness.test.js` | migration/backfill/locking |
| `agent/src/test/java/.../HarnessTicketProcessorReadinessTest.java` | post/release/no harness |
| `frontend/src/__tests__/readinessPanel.test.ts` | panel/actions/errors |
| `frontend/src/__tests__/ticketBoardReadiness.test.ts` | drag restore |
| `frontend/cypress/component/ReadinessPanel.cy.ts` | component flow |

## 2. Migration 061

File: `backend/src/migrations/061_ticket_readiness.sql` (+ `_rollback.sql`).
If fg-55 has already taken 060, use the next free number; register it in
`apply.js` **array order**.

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
  action VARCHAR(32) NOT NULL,
  attempt_id UUID UNIQUE,
  actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('user','runtime','system')),
  actor_user_id BIGINT REFERENCES users(id),
  actor_runtime_id BIGINT REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  actor_node_id BIGINT REFERENCES agent_nodes(id) ON DELETE SET NULL,
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

INSERT INTO permissions (code, description) VALUES
  ('TICKET_READINESS_APPROVE', 'Approve a ticket plan for execution'),
  ('TICKET_READINESS_OVERRIDE', 'Grant a readiness override or small-fix exemption')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('project_admin','super_admin')
  AND p.code IN ('TICKET_READINESS_APPROVE','TICKET_READINESS_OVERRIDE')
ON CONFLICT DO NOTHING;
```

Grandfather backfill (same migration):

```sql
UPDATE tickets
SET readiness_grandfathered_at = COALESCE(updated_at, NOW()),
    ready_at = COALESCE(updated_at, NOW()),
    plan_approved_at = COALESCE(updated_at, NOW()),
    planning_status = COALESCE(planning_status, 'completed')
WHERE status IN ('in_progress','review','done');
```

Rollback drops the two tables and the new columns; it does not touch tickets
created after the backfill.

## 3. `ProjectAccessService`

```js
async isProjectMember(userId, projectId)      // owner or project_memberships
async assertProjectMember(userId, projectId, { role, allowSuperAdmin = true })
```

Use `req.user.userId` for a runtime actor (the node owner), never the runtime
id. `super_admin` bypasses; `project_admin` still needs membership.

## 4. `ReadinessEvaluator`

```js
async evaluate(ticketId) -> {
  ready, planningStatus, planApproved, template, waivedCodes,
  overrideExpiresAt, sectionsEnforced, issues: [{ code, message, field?, file? }]
}
```

- Parse `01`/`02` (or lightweight `00`) from the ticket's planning files.
- Required sections per template; placeholders; acceptance criteria; risk
  sections; requirement IDs.
- Security-sensitive scope from scope/description/planning text.
- `waivedCodes` filters matching issue codes; an expired waiver is ignored.
- Custom templates with no `requiredSections` set `sectionsEnforced: false`.

## 5. `TicketReadinessService`

```js
async evaluate(ticketId)
async assertReadyForExecution(ticketId, { toStatus, toPhase, source, actor, attemptId })
async approvePlan(ticketId, { actor, userId, role })
async replan(ticketId, { actor, userId, role })
async smallFix(ticketId, { reason, actor, userId, role })
async override(ticketId, { codes, reason, expiresAt, actor, userId, role })
async revokeOverride(ticketId, { actor, userId, role })
async refreshReadyState(ticketId, actor)
async emitBlocked(result)
async sweepOverrides()
```

`assertReadyForExecution` reads `READINESS_GATE_MODE` (`off|warn|enforce`,
default `warn`), skips `readiness_grandfathered_at`, evaluates inside the
caller's transaction and throws `ReadinessError` only in `enforce`. The caller
emits `blocked` after `COMMIT` (warn) or `ROLLBACK` (enforce).

`ReadinessError extends AppError`: `statusCode=409`, `code='READINESS_FAILED'`,
`details.issues`, `result` carrying `{ ticketId, toStatus, toPhase, issues,
waivedCodes, mode, attemptId, source, actor }`.

## 6. Gate wiring

| Path | Call |
|---|---|
| `TicketService.pickUpTicket` | `assertReadyForExecution(id, { toStatus:'in_progress', source:'pickup', actor, attemptId })` before the update |
| `TicketService.updateStatus` | only when `status === 'in_progress'` |
| `TicketService.update` | only when the payload changes `status` to `in_progress` |
| `PhaseService.transition` | when `PHASE_TO_STATUS[toPhase] === 'in_progress'` |
| `TicketPlanningService.updateStatus` | reject `completed` with `PLANNING_STATUS_FORBIDDEN`; any move out with `REPLAN_REQUIRED` |

Only `enforce` throws; `warn` returns the result and the caller emits the
blocked event after commit.

## 7. API

| Method | Path | Auth |
|---|---|---|
| GET | `/tickets/:id/readiness` | `TICKET_READ` |
| POST | `/tickets/:id/readiness/approve-plan` | `TICKET_READINESS_APPROVE` |
| POST | `/tickets/:id/readiness/small-fix` | `TICKET_READINESS_OVERRIDE` |
| POST | `/tickets/:id/readiness/replan` | `TICKET_READINESS_APPROVE` |
| POST | `/tickets/:id/readiness/override` | `TICKET_READINESS_OVERRIDE` |
| DELETE | `/tickets/:id/readiness/override` | `TICKET_READINESS_OVERRIDE` |
| GET/POST/PUT/DELETE | `/tickets/:id/acceptance-criteria[/:criterionId]` | `TICKET_UPDATE` |

All write actions also call `assertProjectMember`.

Error envelope:

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

## 8. Agent

- `ApiResponse.Error` gains `details` (map/JsonNode).
- `ApiService` throws `ReadinessException` with the issue list instead of a
  generic `IOException`.
- `HarnessTicketProcessor.processTicket` catches it, posts a `status` message
  with the codes, calls `releaseTicket`, returns without cloning/starting the
  harness, and logs `readiness_blocked`.

## 9. Frontend

- `frontend/src/api/tickets.ts`: remove `.catch(() => null)` from
  `updateTicket`; propagate 409/details; add criteria calls.
- `frontend/src/api/readiness.ts`: evaluate/approve/small-fix/replan/override.
- `ReadinessPanel.vue`: badge, issues, actions, dialogs; `ReadinessIssues.vue`
  shared by detail and board.
- `TicketDetail.vue`: mount the panel; `planning_status=completed` read-only
  when approved; “Replan” reopens.
- `TicketBoard.vue`: create wizard fields (template/small-fix/criteria);
  `handleDrop` restores the previous column and shows issues on 409.
- Cypress component test for the panel.

## 10. Templates

Add these sections to the root template and the built-in `TemplateService`
strings:

- `01_ARCHITECT_REQUIREMENT.md`: `## Assumptions`, `## Change impact`.
- `02_ARCHITECT_DESIGN.md`: `## Failure modes and recovery`,
  `## Security considerations`.
- `planning/lightweight/00`: `## Assumptions`, `## Change impact`.
- Product templates: same headings.

Do **not** add the fg-50 drift test (D7); it is a follow-up.

## 11. Rollout

1. Ship schema/evaluator/API with `READINESS_GATE_MODE=warn`.
2. Run the grandfather backfill.
3. Watch blocked attempts/metrics.
4. Flip to `enforce` for new tickets; keep existing tickets grandfathered.
5. Start the expiry sweep before enabling overrides.
6. Rollback: set `READINESS_GATE_MODE=off`, delete routes, run the migration
   rollback.

## 12. Verification commands

```bash
cd backend && npm test -- --runInBand
cd backend && npm run test:integration
cd backend && npm run lint
cd agent && mvn test
cd frontend && npm test -- --run
cd frontend && npm run typecheck
cd frontend && npm run lint
cd frontend && npm run cypress:component
node planning/check-planning.js
git diff --check
```
