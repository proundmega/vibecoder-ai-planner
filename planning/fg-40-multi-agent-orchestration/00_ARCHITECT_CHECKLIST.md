---
id: "fg-40"
title: "Multi-Agent Orchestration"
status: planned
priority: "P2"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-31", "fg-32", "fg-33", "fg-36"]
---

# 00 — Multi-Agent Orchestration (fg-40)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `AgentApp`, `TicketWorker`, `HarnessTicketProcessor`, `PhaseService`

## Why this ticket exists

Today one process is a builder or a reviewer; there is no fixer yet (fg-32 plans it). There is no task decomposition, parallel work ownership, worktree isolation or handoff contract. fg-30 sketches a reviewer/fixer chain, but multi-agent coordination is undefined.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Durable task/run state | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D2 | Merge queue for integrator | fg-36 | Delivery | fg-36-merge-lifecycle | open |
| D3 | Per-agent budgets | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Task-graph observability | fg-41 | Observability | fg-41-harness-observability | open |
