# 03 — Implementation ({{id}})

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
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

Requirement IDs are the traceability keys for `fg-51`. Name each test with its
ID (`FR1` in the test name, an `@req FR1` annotation, or a manifest entry) so
the traceability check can map requirement → code → test → verification. A
suite-level green run without a mapped test is `partial`, not `verified`.

## Verification commands

The standard set lives in `planning/ENGINEERING_STANDARDS.md` →
*Definition of done*. Ticket-specific additions:

```bash
node planning/check-planning.js
{{command}}
```

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built
- [ ] `check-planning.js` passes; no status/claim/index mismatch
- [ ] Independent reviewer evidence is recorded; every blocking finding is resolved
- [ ] `status: done` only if the implementation PR is merged and Results is non-placeholder
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`

## Review record

Record the review loop, not a narrative. The reviewer is a separate session/
agent (see `planning/README.md` §Review policy); the second pass is `fg-47`.

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | {{primary / second}} | {{finding IDs or none}} | {{commit / change}} | {{new SHA / none}} |

Only blocking findings gate. Non-blocking findings belong in the deferred
register or a follow-up ticket, not in an endless round.

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| {{YYYY-MM-DD}} | {{sha}} | {{e.g. backend 115/1476, agent 180}} | {{pass/fail}} |

A placeholder, `Not run`, or empty row means the suite is **not done**.
