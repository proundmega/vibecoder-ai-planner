---
id: "fg-41"
title: "Harness Observability, Replay and Audit"
status: planned
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-33"]
---

# 00 — Harness Observability, Replay and Audit (fg-41)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `HarnessEvent`, `HarnessTicketProcessor`, `AgentApp`, logging/metrics

## Why this ticket exists

The harness emits sparse logs and heartbeat steps. There is no structured per-run event stream, no trace correlation, no replay, and no immutable audit trail. Debugging a failed ticket means reading interleaved container logs.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Reuse log aggregation transport | bp-106 | Observability | bp-106 follow-up | open |
| D2 | Durable run/checkpoint state | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D3 | Budget metrics and alerts | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Retention/redaction policy | fg-42 | Privacy | fg-42-harness-privacy | open |
