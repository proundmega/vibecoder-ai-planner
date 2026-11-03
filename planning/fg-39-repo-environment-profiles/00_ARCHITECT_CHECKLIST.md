---
id: "fg-39"
title: "Repository Onboarding and Environment Profiles"
status: planned
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-34"]
---

# 00 — Repository Onboarding and Environment Profiles (fg-39)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `VerificationRunner`, `WorkspaceManager`, `agent/Dockerfile`, project settings

## Why this ticket exists

The harness currently assumes the cloned repo can install and test itself. Real projects need pinned toolchains, dependency caches, databases/Redis, monorepo commands, test data and known flaky-test handling. Most agent failures will be environment failures, not coding failures.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Sandbox images and supply chain | fg-34 | Security | fg-34-harness-sandbox | open |
| D2 | Evaluate profile reliability | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D3 | Cache-aware budgets | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Profile/setup telemetry | fg-41 | Observability | fg-41-harness-observability | open |
