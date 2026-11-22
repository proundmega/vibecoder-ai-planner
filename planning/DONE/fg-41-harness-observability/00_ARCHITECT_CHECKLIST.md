---
id: "fg-41"
title: "Harness Observability, Replay and Audit"
status: done
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-22"
pr: 163
branch: null
depends_on: ["fg-30", "fg-33"]
---

# 00 — Harness Observability, Replay and Audit (fg-41)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `HarnessEvent`, `HarnessTicketProcessor`, `AgentApp`, logging/metrics

## Why this ticket exists

The harness emits sparse logs and heartbeat steps. There is no structured per-run event stream, no trace correlation, no replay, and no immutable audit trail. Debugging a failed ticket means reading interleaved container logs.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Implementation merged | PR #163 (`5dff931`); replay/dashboards/audit follow-up #165 (`7726a28`) | ☑ |
| Verification results | `03` → Results; backend, agent and frontend green at merge | ☑ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Reuse log aggregation transport | bp-106 | Observability | bp-106 follow-up | open |
| D2 | Durable run/checkpoint state | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D3 | Budget metrics and alerts | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Retention/redaction policy | fg-42 | Privacy | fg-42-harness-privacy | open |
| D5 | Merge/rollback audit events | fg-36 | Audit | fg-36-merge-lifecycle | open |

## Relationship to fg-54 (planned)

Run and event attribution will use `runtime_id` plus `node_id` once fg-54 lands;
existing `agent_id` fields map 1:1 to `runtime_id`. **`harness_events` stays
append-only:** fg-54 does not update, rename or delete historical rows; it only
adds a nullable `runtime_id` column for new events. No requirement changes.
