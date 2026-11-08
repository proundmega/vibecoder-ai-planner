---
id: "fg-50"
title: "Planning Template Hygiene"
status: planned
priority: "P1"
effort: "Large"
scope: "Infra"
created: "2026-11-08"
updated: "2026-11-08"
pr: null
branch: null
depends_on: ["fg-48", "fg-49"]
---

# 00 — Planning Template Hygiene (fg-50)

> **Owns:** status, status evidence, readiness/completion gates, deferred scope,
> user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`).

## Why this ticket exists

The planning templates now have three kinds of drift:

1. canonical Markdown lives in `planning/` but the product templates in
   `backend/src/services/TemplateService.js` and the frontend labels are
   maintained separately;
2. completed suites remain in the active `planning/` root with stale status
   formats and old `04` wording;
3. `PENDING.txt`, `HARNESS_ROADMAP.md` and `00` frontmatter carry overlapping
   status information, validated only partially by `check-planning.js`.

The result is manual cleanup work every time a template changes, plus active
suites that escape the checker.

## Ticket map

| Doc | Present | Note |
|---|---|---|
| `01_ARCHITECT_REQUIREMENT.md` | ☑ | |
| `02_ARCHITECT_DESIGN.md` | ☑ | |
| `03_ARCHITECT_IMPLEMENTATION.md` | ☑ | |
| `04_SPECIFICATION.md` | ☐ | optional; lifecycle rule is in `01` |
| `05_RUNBOOK.md` | ☐ | |

## Readiness gate (before implementation)

- [x] `01` has numbered requirements with testable acceptance
- [x] `02` records the current-state audit and rollout
- [x] `03` has a verification-matrix row for every requirement
- [x] The work is docs/checker-only; no runtime behavior change
- [x] Historical `DONE/` and `archived/` content is preserved

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | pending | ☐ |
| Implementation completed | pending | ☐ |
| Verification results | pending | ☐ |

A merged planning PR is **plan merged**, not `done`. Set `status: done` only
after the implementation PR is merged and `03` has a dated Results row.

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Migrate every legacy suite, including historical ones | self | Tooling | none | open |
| D2 | Auto-fix trivial template placeholders | fg-49 | Tooling | none | open |
| D3 | Publish generated indexes as a machine-readable artifact | self | Tooling | none | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Single source for model-facing templates | read `planning/` Markdown at build time / keep copies and add a drift test | Drift test first; generation later | |

## Completion gate

- [ ] Every requirement is met
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `status` is `done` only after the implementation PR merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match this file

## Notes

This is intentionally a cleanup and enforcement ticket, not a redesign of the
planning document model. Keep the changes reviewable in slices; moving
directories must not rewrite historical content.
