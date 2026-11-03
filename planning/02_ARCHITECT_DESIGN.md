# 02 — Design ({{id}})

> **Owns:** current-state audit, chosen design, data model, contracts, risks,
> rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), exact file
> operations (`04`), status and deferrals (`00`).

## Current state (the only infrastructure audit)

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Backend route/controller/service | {{yes/no}} | `backend/src/...` | |
| Database table/column | {{yes/no}} | `backend/src/migrations/...` | |
| Frontend API client | {{yes/no}} | `frontend/src/api/...` | |
| Frontend view/component/route | {{yes/no}} | `frontend/src/...` | |
| Agent code | {{yes/no}} | `agent/src/...` | |

**Key insight:** {{frontend-only / backend-first / extend both / new build}}

## Design summary

{{2–4 paragraphs or a small diagram. Explain why this shape, not a full
restatement of the requirement.}}

## Alternatives considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A · {{...}} | | | chosen |
| B · {{...}} | | | rejected because … |

## Data model & migrations

```sql
{{CREATE TABLE / ALTER TABLE / CREATE INDEX}}
```

- Migration: `backend/src/migrations/NNN_{{name}}.sql`
- Rollback: `backend/src/migrations/NNN_{{name}}_rollback.sql`
- Backfill: {{yes/no — what and how}}
- Apply order: add to the array in `backend/src/migrations/apply.js`

## API contract

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| {{GET}} | `/api/v1/...` | {{JWT / agent key}} | {{...}} | `{ success, data }` | {{400/403/404/409}} |

## Data flow

```
{{trigger}} → {{layer}} → {{layer}} → {{storage}} → {{response}}
```

## Failure handling & recovery

| Failure | Detection | Behaviour | Operator action |
|---|---|---|---|
| {{...}} | | | |

## Security

- Authentication: {{...}}
- Authorization: {{permission names}}
- Input validation: {{Joi schema}}
- Sensitive data: {{what is stored, masked or redacted}}
- Rate limiting: {{...}}

## Performance

- Expected load: {{...}}
- Query/index risks: {{...}}
- Pagination: {{...}}

## Risks & edge cases

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| {{...}} | | |

## Rollout

1. {{migration → backend → frontend → enable flag}}
2. Rollback: {{...}}

## Open questions

| # | Question | Resolution |
|---|---|---|
| 1 | {{...}} | {{...}} |

Deferred items are recorded in **`00` → Deferred register**; do not list them
here.
