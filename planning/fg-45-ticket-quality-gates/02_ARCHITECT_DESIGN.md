# 02_ARCHITECT_DESIGN.md - Ticket Quality Gates and Definition of Ready (fg-45)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31/32

## Design summary

Add a readiness evaluation layer used by the API, phase transitions and agent pickup. The UI guides users to readiness; the backend is the source of truth.

```
Create ticket (draft)
  -> choose template / small-fix exemption
  -> apply template files
  -> fill scope + acceptance criteria
  -> readiness evaluator
       -> ready: claimable / can enter in_progress
       -> not ready: issues[] shown in UI and to agents
  -> override (authorized, reason, audit)
```

## Data model

Prefer extending `tickets`:

```sql
ALTER TABLE tickets ADD COLUMN readiness_override_by BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN readiness_override_reason TEXT;
ALTER TABLE tickets ADD COLUMN readiness_override_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN ready_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN ready_by BIGINT REFERENCES users(id);
```

Optionally add `ticket_acceptance_criteria` if a dedicated field is preferred over parsing the template.

`planning_status` remains, but `completed` is only writable through the readiness service or an audited override.

## Readiness evaluator

`TicketReadinessService.evaluate(ticketId)` returns:

```json
{
  "ready": false,
  "planningStatus": "template_selected",
  "template": "architecture",
  "issues": [
    { "code": "DESCRIPTION_TOO_SHORT", "message": "..." },
    { "code": "MISSING_REQUIRED_FILE", "file": "02_ARCHITECT_DESIGN.md" },
    { "code": "PLACEHOLDER", "file": "03_ARCHITECT_IMPLEMENTATION.md", "marker": "{{DATE}}" },
    { "code": "MISSING_ACCEPTANCE_CRITERIA" }
  ]
}
```

Checks:

1. title not generic/too short;
2. description length and non-empty;
3. template applied or small-fix exemption;
4. required files exist and are non-empty;
5. required sections present;
6. no placeholder markers;
7. at least one acceptance criterion;
8. plan marked complete by an authorized human/architect;
9. dependencies/test/rollback sections for non-small templates.

Issue codes are stable so the UI and agents can render them.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/tickets/:id/readiness` | Evaluate and return issues |
| POST | `/tickets/:id/readiness/complete` | Mark ready after validation (human/architect) |
| POST | `/tickets/:id/readiness/override` | Authorized override with reason |
| POST | `/tickets/:id/planning/apply-template` | Existing endpoint; returns template files |

Enforcement:

- `TicketService.pickUpTicket` calls `evaluate` and throws `ValidationError` with `READINESS_FAILED` and issues.
- `PhaseService.transition` to `in_progress` checks readiness unless `readiness_override_at` is set.
- Agent `pickUpTicket` failure handling posts issues and releases the ticket.

## UI

### Create ticket wizard

1. Project, title, priority.
2. Description with minimum length.
3. Template selector (architecture/technical/simple/custom) or “Small fix” checkbox + reason.
4. Acceptance criteria (repeatable rows).
5. Create draft or Create + apply template.

### Ticket detail

- Readiness panel with:
  - ready/not-ready badge;
  - issues list with links to the relevant planning file;
  - “Apply template”, “Complete planning”, “Override” actions;
  - override requires a reason and permission.
- Planning status is read-only unless the user is authorized.

## Small-fix exemption

- Record `readiness_override_by`, reason, timestamp.
- Allowed by project admins/architects, optionally by the ticket owner for `simple` template.
- Audit event: `ticket.readiness_override`.
- The UI must show the exemption on the ticket and in the agent prompt.

## Agent behavior

- On pickup failure with `READINESS_FAILED`:
  - post a `status` message with the issue list;
  - do not clone or start a harness;
  - release the ticket;
  - log a readiness-blocked event.
- The prompt for a small-fix ticket includes the exemption reason.

## Backfill and rollout

1. Add fields/services with the gate disabled.
2. Backfill `ready_at` for existing `in_progress`, `review`, `human_approval`, `done` tickets.
3. Enable the gate for new backlog tickets only.
4. Triage existing backlog tickets; show readiness issues.
5. Enable phase-transition gating.
6. Add metrics/alerts.

## Metrics

- `tickets_ready_total`, `tickets_blocked_by_readiness_total{code}`
- readiness rate by project
- time from creation to ready
- override rate and reasons
- agent pickups rejected by readiness

## Tests

- schema rejects title-only creation (or creates draft with `not_ready`);
- evaluator for each issue code;
- template/small-fix paths;
- pickup/phase gates;
- override permission/audit;
- agent posts issues and releases;
- backfill/grandfather;
- UI wizard and readiness panel.

## Open questions

1. Do we allow title-only draft creation, or require description immediately?
2. Is acceptance criteria a dedicated column or template parsing?
3. Who can override: project admin, architect, owner?
4. Minimum description length? (Proposal: 80 characters.)
5. Do we enforce readiness for existing backlog tickets immediately or after triage?
6. Should `simple` template be the default for small fixes?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | AI-assisted plan drafting | Agent / UX | `fg-30` Phase 2 | No |
| 2 | fg-46 | Readiness/blocked metrics | Observability | `fg-46-flow-observability` | No |
| 3 | fg-37 | Readiness vs quality metrics | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-31 | Reviewer readiness checks | Review | `fg-31` follow-up | No |
