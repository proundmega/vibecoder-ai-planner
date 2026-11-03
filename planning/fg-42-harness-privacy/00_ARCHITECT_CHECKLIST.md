---
id: "fg-42"
title: "Harness Privacy and Data Governance"
status: planned
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-34", "fg-41"]
---

# 00 — Harness Privacy and Data Governance (fg-42)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `PromptBuilder`, `PlanningDocFetcher`, `HarnessEvent`, provider config

## Why this ticket exists

The harness sends ticket text, planning docs, source files, diffs and test output to an external model. There is no classification, redaction, provider policy, tenant isolation or retention control for that data.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Sandbox network/secret boundary | fg-34 | Security | fg-34-harness-sandbox | open |
| D2 | Scoped credentials | fg-35 | Security | fg-35-github-app-credentials | open |
| D3 | Provider routing | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Event redaction/retention | fg-41 | Observability | fg-41-harness-observability | open |
