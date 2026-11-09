# 03 — Implementation (fg-50)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), status (`00`).

## Plan

1. **Lifecycle cleanup** — move done suites to `DONE/`, update indexes, add the
   active-done checker rule — verify: `node planning/check-planning.js`.
2. **Template drift guard** — add the required-heading/banned-phrase test for
   repo and product templates (`00`–`04`, including risk sections and the
   lightweight `00`) — verify: `node --test planning/check-planning.test.js`
   and `cd backend && npm test -- templateService`.
3. **Active-suite rules** — add retired-wording, legacy-status and frontmatter
   checks scoped to `in_progress`/`in_review`/`done`; exempt `planned`,
   `deferred`, `DONE/`, `archived/`, `lightweight/` and legacy suites; ignore
   fenced examples and the Results table — verify:
   `node planning/check-planning.js`.
4. **Index validation** — generate or strictly validate
   `PENDING.txt`/`HARNESS_ROADMAP.md` rows — verify: `node planning/check-planning.js`.
5. **`04` lifecycle** — update the template and planning README to mark it as
   execution-time only — verify: `node planning/check-planning.js`.
6. **Repository self-check** — add a test that runs the checker against the
   repository root and asserts exit 0 — verify:
   `node --test planning/check-planning.test.js`.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `planning/` completed suites | MOVE | Move `status: done` suites into `DONE/` without rewriting content |
| `planning/check-planning.js` | MODIFY | Add lifecycle, scoped wording/frontmatter and index checks; keep the `lightweight` exemption already added in this PR |
| `planning/check-planning.test.js` | MODIFY | Add fixtures/tests for the new rules, legacy reporting and the repository self-check |
| `planning/README.md` | MODIFY | Document the lifecycle, template drift, scope/exemptions and `04` rules |
| `planning/00_ARCHITECT_CHECKLIST.md` | MODIFY | Keep readiness/risk gates aligned |
| `planning/01_ARCHITECT_REQUIREMENT.md` | MODIFY | Keep assumptions and change impact aligned with the product `01` template |
| `planning/02_ARCHITECT_DESIGN.md` | MODIFY | Keep failure modes and security considerations aligned with the product `02` template |
| `planning/lightweight/00_ARCHITECT_CHECKLIST.md` | MODIFY | Add the lightweight assumptions/change-impact sections |
| `planning/04_SPECIFICATION.md` | MODIFY | Mark the spec as execution-time only |
| `backend/src/services/TemplateService.js` | MODIFY | Align the `04` product template with the canonical wording |
| `frontend/src/views/phases/PhasePlanning.vue` | MODIFY | Keep the product label aligned with the template |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Keep the template description aligned |
| `PENDING.txt`, `planning/HARNESS_ROADMAP.md` | MODIFY | Regenerate or validate status rows |

## Dependencies

- `fg-48` owns evidence/claim checks; this ticket owns structure, lifecycle and
  template drift.
- `fg-49` owns unresolved-placeholder detection and its expected output; this
  ticket reuses its status/fence/Results scope for retired wording.
- `fg-45` owns the risk-section policy; this ticket keeps the templates aligned
  with it.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Node script | `planning/check-planning.test.js` | `FR1 active done suite fails; moved suite passes` | `node --test planning/check-planning.test.js` |
| FR2 | Backend unit | `backend/src/__tests__/templateService.test.js` | `FR2 repo/product 00–04 headings and banned phrases agree, including assumptions/change impact/failure modes/security and lightweight 00` | `cd backend && npm test -- templateService` |
| FR3 | Node script | `planning/check-planning.test.js` | `FR3 retired wording in an in-progress suite fails; planned, DONE/ and legacy fixtures pass/report separately; fenced/inline examples pass` | `node --test planning/check-planning.test.js` |
| FR4 | Node script | `planning/check-planning.test.js` | `FR4 legacy **Status** planned suite fails; legacy done fixture passes` | `node --test planning/check-planning.test.js` |
| FR5 | Node script | `planning/check-planning.test.js` | `FR5 mismatched/missing index row fails` | `node --test planning/check-planning.test.js` |
| FR6 | Docs | `planning/README.md`, `planning/04_SPECIFICATION.md` | `FR6 execution-only wording present` | `node planning/check-planning.js` |
| FR7 | Node script | `planning/check-planning.test.js` | `FR7 repository self-check exits 0` | `node --test planning/check-planning.test.js` |
| NFR1 | Node script | `planning/check-planning.test.js` | `NFR1 repeated runs deterministic; no network` | `node --test planning/check-planning.test.js` |

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
| | | | |
