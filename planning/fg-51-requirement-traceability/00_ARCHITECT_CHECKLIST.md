---
id: "fg-51"
title: "Requirement Traceability and Merge Readiness"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-11-08"
updated: "2026-11-08"
pr: null
branch: null
depends_on: ["fg-31", "fg-45", "fg-48"]
---

# 00 — Requirement Traceability and Merge Readiness (fg-51)

> **Owns:** status, status evidence, ticket map, readiness/completion gates,
> deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> exact file operations (`04`).

## Why this ticket exists

Every planning suite numbers its requirements (`FR1`, `NFR1`, …) and `03` maps
them to planned tests, but nothing proves after implementation that each
requirement is actually implemented and verified. `fg-48` checks the planning
documents for internal consistency; it cannot see the code, the test run or the
verification result. A reviewer sees a diff and maybe a green test suite, not a
requirement-to-evidence map. The result is that a partially implemented or
untested requirement can reach `human_approval` and merge.

## Ticket map

| Doc | Present | Note |
|---|---|---|
| `01_ARCHITECT_REQUIREMENT.md` | ☑ | |
| `02_ARCHITECT_DESIGN.md` | ☑ | |
| `03_ARCHITECT_IMPLEMENTATION.md` | ☑ | |
| `04_SPECIFICATION.md` | ☐ | optional |
| `05_RUNBOOK.md` | ☐ | |

## Readiness gate (before implementation)

- [x] `01` has numbered `FR*`/`NFR*` requirements with testable acceptance
- [x] `02` records the current-state audit, evidence sources and gate design
- [x] `03` has a verification-matrix row for every requirement
- [x] `fg-31`, `fg-45` and `fg-48` own their adjacent pieces; this ticket does
      not duplicate them
- [x] The feature is additive and can ship behind `TRACEABILITY_GATE_MODE=warn`

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
| D1 | Semantic code-to-requirement inference without annotations | self | Tooling | none | open |
| D2 | Auto-generate missing tests from acceptance criteria | self | Agent / Testing | none | open |
| D3 | Report adapters beyond JUnit XML, Jest/Vitest JSON and pytest JSON | self | Tooling | none | open |
| D4 | Cross-ticket / cross-repository traceability | self | Tooling | none | open |
| D5 | Traceability trends and dashboards | fg-41 | Observability | fg-41-harness-observability | open |
| D6 | Monorepo / package-scoped requirement mapping | self | Tooling | none | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | How authors declare the requirement → code/test mapping | annotations only / manifest only / both | Both: annotations preferred; a manifest covers generated and legacy code | |
| 2 | Initial gate mode | `warn` first / `enforce` immediately | `warn` for one pilot suite, then `enforce` | |
| 3 | Where the gate runs | PR head only / merge queue only / both | PR head first; `fg-36` reuses the latest snapshot | |
| 4 | Authoritative test evidence | CI reports / supervisor verification / both | Both; the supervisor result for the reviewed SHA is authoritative | |

## Completion gate

- [ ] Every requirement is met
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `status` is `done` only after the implementation PR merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match this file

## Notes

This is the implementation-side counterpart to `fg-48`. Keep the report
factual: counts and per-requirement rows, not a composite “readiness score”.
A single percentage hides which requirements are missing and invites gaming.
