---
id: "fg-37"
title: "Agent Evaluation Harness"
status: planned
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-31", "fg-32"]
---

# 00 — Agent Evaluation Harness (fg-37)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** agent harness, `planning/`, CI

## Why this ticket exists

We cannot currently answer "is the agent getting better?" in a repeatable way. The Beam/Iceman comparison was a one-off benchmark, not a regression suite. There is no golden task set, no quality metrics, no reviewer calibration and no gate for prompt/model/config changes.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | E2E UI for eval reports | bp-99-frontend-testing | Testing | TBD (new follow-up) | open |
| D2 | Reviewer calibration | fg-31 | Review | fg-31 follow-up | open |
| D3 | Sandboxed eval repos | fg-34 | Security | fg-34-harness-sandbox | open |
| D4 | Sandboxed evaluation repos | fg-34 | Security | TBD (new follow-up) | open |
| D5 | Budget-aware eval runs | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D6 | Budget-aware evaluation runs | fg-38 | Billing | TBD (new follow-up) | open |
| D7 | Eval dashboards | fg-41 | Observability | fg-41-harness-observability | open |
| D8 | Eval result dashboards | fg-41 | Observability | TBD (new follow-up) | open |
