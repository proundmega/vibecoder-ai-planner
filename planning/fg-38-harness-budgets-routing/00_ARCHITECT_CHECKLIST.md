---
id: "fg-38"
title: "Harness Budgets and Model Routing"
status: in_progress
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-16"
pr: null
branch: null
depends_on: ["fg-30"]
---

# 00 — Harness Budgets and Model Routing (fg-38)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `HarnessConfig`, `OpenCodeClient`, `HarnessTicketProcessor`, usage/billing APIs

## Relationship to fg-54 (planned)

`fg-54` owns the credential/model registry (`provider_credentials`,
`provider_models`, role tags, verification). This ticket stays the consumer:
routing and budget policy select a model from that registry, and usage
attribution records `runtime_id`/`node_id` once fg-54 lands. No requirement
changes; `agent` in FR8 means the runtime.

## Why this ticket exists

fg-30 defines budget defaults (45 min, 1.5M tokens, $5, 100 tool calls), but nothing enforces them. There is no live token meter, no hard stop, no per-project quota, and no policy for choosing Beam Free vs a paid model or handling a provider outage.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Reuse usage/billing aggregation | bp-04 | Billing | bp-04 follow-up | open |
| D2 | Durable usage checkpoints | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D3 | Use eval quality to inform routing | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D4 | Budget/token dashboards | fg-41 | Observability | fg-41-harness-observability | open |
| D5 | Price-table change ownership | fg-38 | Billing | operator runbook | open |
