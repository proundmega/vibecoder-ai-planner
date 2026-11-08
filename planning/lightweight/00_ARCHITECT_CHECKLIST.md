---
id: "{{id}}"
title: "{{Title}}"
status: planned
priority: "{{P2}}"
effort: "Small"
scope: "{{Frontend | Backend | Both | Agent | Infra}}"
created: "{{YYYY-MM-DD}}"
updated: "{{YYYY-MM-DD}}"
pr: null
branch: null
depends_on: []
---

# 00 — {{Title}} ({{id}})

> Lightweight suite: a small, single-layer change with no API/DB contract,
> auth/permission, migration, or agent-boundary change. Use the full templates
> when any of those apply.

## Why this ticket exists

{{2–4 sentences: the failure or gap, who it affects, what changes.}}

## Requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | {{what the system must do}} | {{observable pass/fail condition}} |
| NFR1 | {{safety, performance or operability constraint}} | {{observable condition}} |

## Readiness gate (before implementation)

- [ ] Scope is one layer and the root cause is understood
- [ ] Every requirement above has a testable acceptance statement
- [ ] The verification command/test is identified
- [ ] No API, database, auth, migration or agent-boundary change is involved

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | {{PR #N / date, or n/a}} | ☐ |
| Implementation completed | {{PR #N + commit, or pending}} | ☐ |
| Verification results | {{`03` Results row, or n/a}} | ☐ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | {{item}} | {{self / fg-XX}} | {{Security / Observability / …}} | {{fg-XX / none}} | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | {{question}} | {{A / B}} | {{A}} | |

If none: *No decisions require user input; the change follows existing
patterns.*

## Completion gate

- [ ] Every requirement is met
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `status` is `done` only after the implementation PR is merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match this file

## Notes

{{Anything that does not belong in the owned sections above. Keep it short.}}
