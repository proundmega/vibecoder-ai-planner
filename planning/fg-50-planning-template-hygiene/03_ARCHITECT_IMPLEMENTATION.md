# 03 — Implementation (fg-50)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), status (`00`).

## Plan

1. **Lifecycle cleanup** — move done suites to `DONE/`, update indexes, add the
   active-done checker rule — verify: `node planning/check-planning.js`.
2. **Template drift guard** — add the required-heading/banned-phrase test for
   repo and product templates — verify: `node --test planning/check-planning.test.js`.
3. **Active-suite rules** — add retired-wording, legacy-status and frontmatter
   checks; exempt `DONE/`, `archived/` and `lightweight/` — verify: `node planning/check-planning.js`.
4. **Index validation** — generate or strictly validate
   `PENDING.txt`/`HARNESS_ROADMAP.md` rows — verify: `node planning/check-planning.js`.
5. **`04` lifecycle** — update the template and planning README to mark it as
   execution-time only — verify: `node planning/check-planning.js`.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `planning/` completed suites | MOVE | Move `status: done` suites into `DONE/` without rewriting content |
| `planning/check-planning.js` | MODIFY | Add lifecycle, wording, frontmatter and index checks |
| `planning/check-planning.test.js` | MODIFY | Add fixtures/tests for the new rules |
| `planning/README.md` | MODIFY | Document the lifecycle, template drift and `04` rules |
| `planning/01_ARCHITECT_REQUIREMENT.md` | MODIFY | Keep assumptions and change impact aligned with the product `01` template |
| `planning/02_ARCHITECT_DESIGN.md` | MODIFY | Keep failure modes and security considerations aligned with the product `02` template |
| `planning/lightweight/00_ARCHITECT_CHECKLIST.md` | MODIFY | Keep the lightweight assumptions section aligned |
| `planning/04_SPECIFICATION.md` | MODIFY | Mark the spec as execution-time only |
| `backend/src/services/TemplateService.js` | MODIFY | Align the `04` product template with the canonical wording |
| `frontend/src/views/phases/PhasePlanning.vue` | MODIFY | Keep the product label aligned with the template |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Keep the template description aligned |
| `PENDING.txt`, `planning/HARNESS_ROADMAP.md` | MODIFY | Regenerate or validate status rows |

## Dependencies

- `fg-48` owns evidence/claim checks; this ticket owns structure, lifecycle and
  template drift.
- `fg-49` owns unresolved-placeholder detection and its expected output.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Node script | `planning/check-planning.test.js` | active done suite fails; moved suite passes | `node --test planning/check-planning.test.js` |
| FR2 | Backend unit | `backend/src/__tests__/templateService.test.js` | repo/product `00`–`04` headings and banned phrases agree, including assumptions/change impact/failure modes/security | `cd backend && npm test -- templateService` |
| FR3 | Node script | `planning/check-planning.test.js` | retired wording in an active suite fails; historical fixtures pass | `node --test planning/check-planning.test.js` |
| FR4 | Node script | `planning/check-planning.test.js` | legacy `**Status**` planned suite fails; legacy done fixture passes | `node --test planning/check-planning.test.js` |
| FR5 | Node script | `planning/check-planning.test.js` | mismatched/missing index row fails | `node --test planning/check-planning.test.js` |
| FR6 | Docs | `planning/README.md`, `planning/04_SPECIFICATION.md` | execution-only wording present | `node planning/check-planning.js` |
| NFR1 | Node script | `planning/check-planning.test.js` | repeated runs deterministic; no network | `node --test planning/check-planning.test.js` |

## Verification commands

```bash
node planning/check-planning.js
node --test planning/check-planning.test.js
cd backend && npm test -- templateService
```

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | pending | pending | pending | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| {{YYYY-MM-DD}} | {{sha}} | {{checker/template tests}} | {{pass/fail}} |
