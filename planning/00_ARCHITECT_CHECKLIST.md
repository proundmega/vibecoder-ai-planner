---
id: "{{bp-XX-slug}}"
title: "{{Title}}"
status: planned          # planned | in_progress | in_review | done | deferred | cancelled
priority: "{{P0 | P1 | P2 | P3 | P4}}"
effort: "{{Small | Medium | Large}}"
scope: "{{Frontend | Backend | Both | Agent | Infra}}"
created: "{{YYYY-MM-DD}}"
updated: "{{YYYY-MM-DD}}"
pr: null                 # PR number once opened
branch: null             # branch name once created
depends_on: []           # e.g. ["fg-30"]
---

# 00 — {{Title}} ({{id}})

> **Owns:** status, ticket map, readiness/completion gates, deferred scope,
> user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), exact file operations (`04`).

## Why this ticket exists

{{2–4 sentences: the failure or gap, who it affects, what changes.}}

## Ticket map

| Doc | Present | Note |
|---|---|---|
| `01_ARCHITECT_REQUIREMENT.md` | ☐ | |
| `02_ARCHITECT_DESIGN.md` | ☐ | |
| `03_ARCHITECT_IMPLEMENTATION.md` | ☐ | |
| `04_SPECIFICATION.md` | ☐ | optional |
| `05_RUNBOOK.md` | ☐ | optional |

## Readiness gate (before implementation)

- [ ] `01` has numbered `FR*`/`NFR*`, each with a testable acceptance statement
- [ ] `02` records the current-state audit and the chosen design
- [ ] `03` has a verification-matrix row for every `FR*`/`NFR*`
- [ ] Deferred register below is complete; out-of-scope items are recorded
      here, not copied into other docs
- [ ] Open decisions are answered or explicitly accepted as assumptions
- [ ] No fact is duplicated across documents (see `planning/README.md`)

## Deferred register (canonical)

Every deliberate omission and every follow-up lives here exactly once.
`Category` is the reason class; add a note when a deferral needs more
justification.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | {{item}} | {{self / fg-XX}} | {{Security / Observability / …}} | {{fg-XX / none}} | open |

States: `open`, `scheduled`, `done`, `dropped`.

`01`, `02`, `03` and `04` link here; they never paste this table.

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | {{question}} | {{A / B}} | {{A}} | |

If none: *No decisions require user input; the design follows existing
patterns.*

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] Verification matrix in `03` is green and results are recorded
- [ ] `status` in the frontmatter above is `done`, and `pr` is set
- [ ] Deferred register reflects what was actually left out

## Notes

{{Anything that does not belong in the owned sections above. Keep it short.}}
