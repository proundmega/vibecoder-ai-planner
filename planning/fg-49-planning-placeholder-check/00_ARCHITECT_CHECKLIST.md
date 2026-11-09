---
id: "fg-49"
title: "Planning Placeholder Check"
status: planned
priority: "P2"
effort: "Small"
scope: "Infra"
created: "2026-11-08"
updated: "2026-11-09"
pr: null
branch: null
depends_on: ["fg-48"]
---

# 00 — Planning Placeholder Check (fg-49)

> **Owns:** status, status evidence, readiness/completion gates, deferred scope,
> user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`).

## Why this ticket exists

Active planning suites can still contain unresolved `{{...}}` placeholders
after a ticket is filled in. `check-planning.js` catches a few placeholders in
completed `03` Results, but not placeholders in `00`, `01`, `02` or `04`, and
not unresolved placeholders in planned suites. They can merge silently and
leave the suite incomplete.

## Ticket map

| Doc | Present | Note |
|---|---|---|
| `01_ARCHITECT_REQUIREMENT.md` | ☑ | |
| `02_ARCHITECT_DESIGN.md` | ☑ | |
| `03_ARCHITECT_IMPLEMENTATION.md` | ☑ | |
| `04_SPECIFICATION.md` | ☐ | not needed for the checker |
| `05_RUNBOOK.md` | ☐ | |

## Readiness gate (before implementation)

- [x] `01` has numbered `FR*`/`NFR*` requirements with testable acceptance
- [x] `01` has assumptions and change impact; `02` records the current state and the checker design (failure/security sections apply to non-small tickets; this is Small)
- [x] `03` has a verification-matrix row for every requirement
- [x] The checker stays deterministic and network-free
- [x] `DONE/`, `archived/` and the lightweight template directory are exempt
- [x] Planned/deferred suites and fenced examples are explicitly exempt
- [x] A repository self-check test proves the check passes where it is committed

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
| D1 | Check placeholders inside fenced code examples | self | Tooling | none | open |
| D2 | Expose a `--fix` mode for trivial date/ID placeholders | self | Tooling | none | open |

## Decisions needed from the user

*No decisions require user input; the checker follows the existing
`check-planning.js` conventions.*

## Completion gate

- [ ] Every requirement is met
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `status` is `done` only after the implementation PR merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match this file

## Notes

This is a follow-up to `fg-48` and should not duplicate its evidence-claim
checks. Keep this check structural: a placeholder is a missing fact, not a
review judgement.
