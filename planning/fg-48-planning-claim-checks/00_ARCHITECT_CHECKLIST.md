---
id: "fg-48"
title: "Planning Claim Verification"
status: planned
priority: "P2"
effort: "Medium"
scope: "Infra"
created: "2026-11-03"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-31", "fg-47"]
---

# 00 — Planning Claim Verification (fg-48)

> **Owns:** status, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), exact file operations (`04`).

**Honest scope:** a script can verify structured claims and invariants. It
cannot understand design prose or decide whether a design is correct. This
ticket builds the former; the reviewer and human keep the latter.

## Why this ticket exists

Planning docs drift in ways that are mechanically checkable: a suite says
`done` while the implementation is a plan, a row says `Merged` when only the
planning PR merged, a matrix omits a requirement, a done suite keeps empty
results, or prose claims "one open follow-up" while the register has seven.
`check-planning.js` now covers the easy structural cases. A richer
`check-claims` pass can verify a small, explicit evidence table and the index
labels without pretending to read the author's mind.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | n/a — planned | ☐ |
| Implementation merged | pending | ☐ |
| Verification results | n/a — planned | ☐ |

## Readiness gate

- [ ] `01` has numbered `FR*`/`NFR*`, each with a testable acceptance statement
- [ ] `02` records the feasibility limits and the chosen design
- [ ] `03` has a verification-matrix row for every `FR*`/`NFR*`
- [ ] Deferred register below is complete
- [ ] The design does not attempt NLP/prose understanding

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Prose/NLP claim extraction | self | Tooling | none — deliberately out of scope | open |
| D2 | GitHub PR/commit existence resolution | self | Integration | optional network check | open |
| D3 | Cross-suite semantic/design validation | self | Tooling | reviewer/human, not a script | open |
| D4 | Auto-fix stale labels/prose | self | Tooling | none — keep the checker read-only | open |
| D5 | Jenkins/pre-commit integration | self | CI | `fg-48` follow-up | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Scope | structural evidence only / prose NLP | structural evidence only | Pending |
| 2 | Failure mode | fail hard invariants + warn heuristics / warn only | fail hard, warn heuristics | Pending |
| 3 | Evidence source | `00` Status evidence + `03` Results/matrix + indexes | that set | Pending |

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] Verification matrix in `03` is green and has a row for every requirement
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `status` is `done` only after the implementation PR merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`
- [ ] Review record in `03` shows all blocking findings resolved
- [ ] Deferred register reflects what was actually left out
