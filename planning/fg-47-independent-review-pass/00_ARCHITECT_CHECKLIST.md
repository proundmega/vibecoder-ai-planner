---
id: "fg-47"
title: "Independent Second Reviewer Pass"
status: planned
priority: "P2"
effort: "Medium"
scope: "Both"
created: "2026-11-03"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-31", "fg-32", "fg-37", "fg-41"]
---

# 00 — Independent Second Reviewer Pass (fg-47)

> **Owns:** status, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), file operations (`04`).

**Flow change.** This ticket adds a second reviewer pass. It does not change
the primary reviewer (`fg-31`) or the fixer loop (`fg-32`); it plugs into both.

## Why this ticket exists

The primary reviewer and the author can share the same model family, prompt
style and blind spots. A same-model reviewer in a fresh context is still
useful — it catches consistency and traceability issues — but it is not a
decorrelated second opinion. For higher-risk changes we want a second pass
with a different model/provider, a separate context and a different review
focus, followed by a triage step that merges findings and escalates real
disagreements to a human.

This is a flow change, not a model change: the win comes from independence,
evidence and triage, not from adding another generic reviewer to every PR.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | n/a — planned | ☐ |
| Implementation merged | pending | ☐ |
| Verification results | n/a — planned | ☐ |

## Readiness gate

- [ ] `01` has numbered `FR*`/`NFR*`, each with a testable acceptance statement
- [ ] `02` records the current-state audit and the chosen design
- [ ] `03` has a verification-matrix row for every `FR*`/`NFR*`
- [ ] Deferred register below is complete
- [ ] Review policy is applied (`planning/README.md` §Review policy)

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Third reviewer / cross-provider calibration pass | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D2 | Reviewer quality scoring and calibration corpus | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D3 | Per-project second-reviewer policy and overrides | fg-45 | Configuration | fg-45-ticket-quality-gates | open |
| D4 | Cost accounting and hard budget for the second pass | fg-38 | Cost | fg-38-harness-budgets-routing | open |
| D5 | Auto-tune trigger policy from escaped defects | fg-37, fg-41 | Evaluation | fg-37 / fg-41 | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Default mode | off / advisory / blocking | `off` initially, then `advisory` on high-risk changes | Pending |
| 2 | Trigger policy | every PR / high-risk only / disagreement only | high-risk + primary/second disagreement | Pending |
| 3 | Model/provider choice | fixed pair / per-project / cheapest different family | different family from the primary, configurable | Pending |

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] Verification matrix in `03` is green and has a row for every requirement
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `status` is `done` only after the implementation PR merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`
- [ ] Review record in `03` shows all blocking findings resolved
- [ ] Deferred register reflects what was actually left out
