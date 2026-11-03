# 03 — Implementation ({{id}})

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

Ordered slices. Each slice should be independently verifiable.

1. **{{Slice name}}** — {{what changes}} — verify: {{command or test}}
2. {{...}}

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/...` | CREATE / MODIFY / DELETE | {{what}} |
| `frontend/src/...` | CREATE / MODIFY / DELETE | {{what}} |
| `agent/src/...` | CREATE / MODIFY / DELETE | {{what}} |

Exact imports and signatures belong in `04` when it exists; otherwise add them
here.

## Dependencies

- {{service, client or ticket this needs}}
- {{what depends on this change}}

## Migration notes

- File: `NNN_{{name}}.sql` + `_rollback.sql`
- Apply order: {{position in the `apply.js` array}}
- Backfill/rollback risk: {{...}}

## Verification matrix (canonical)

One row per requirement. This table is the contract between `01` and the code.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | backend unit | `backend/src/__tests__/...` | {{name}} | `npm test` |
| FR1 | bash integration | `backend/integration-test/suites/...` | {{name}} | `bash integration-test/run.sh --only` |
| NFR1 | agent unit | `agent/src/test/...` | {{name}} | `mvn test` |

A requirement with no row is not done.

## Verification commands

The standard set lives in `planning/ENGINEERING_STANDARDS.md` →
*Definition of done*. Ticket-specific additions:

```bash
{{command}}
```

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| {{YYYY-MM-DD}} | {{sha}} | {{e.g. backend 115/1476, agent 180}} | {{pass/fail}} |
