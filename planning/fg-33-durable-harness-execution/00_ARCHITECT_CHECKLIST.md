---
id: "fg-33"
title: "Durable Harness Execution"
status: done
priority: "P0"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-03"
pr: 110
branch: "feat/fg-33-durable-harness-execution"
depends_on: ["fg-30"]
---

# 00 — Durable Harness Execution (fg-33)

> **Owns:** status, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), file operations (`04`).

**Related code:** `HarnessTicketProcessor`, `WorkspaceManager`, `AgentApp`,
`OpenCodeClient`, `HarnessRunService`, `api/harnessRuns.js`

## Why this ticket exists

Phase 1 keeps the whole run in memory: clone, OpenCode session, prompt,
verification and publish. If the agent process or container dies, the ticket
can stay locked, the workspace is orphaned, the OpenCode session is lost, and
there is no safe resume path. The `finally` cleanup only runs on a normal JVM
exit.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Structured harness event stream and replay | fg-30 | Observability | fg-41-harness-observability | open |
| D2 | Run workspaces inside an isolated sandbox | fg-34 | Security | fg-34-harness-sandbox | open |
| D3 | Parallel worktrees and multi-agent leases | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D4 | Ship run/lease events to log aggregation | bp-106 | Observability | bp-106 follow-up | open |
| D5 | Budget-aware retry policy | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D6 | CI process-kill matrix and live-session resume | self | Testing | none | open |
| D7 | Scheduled workspace pruning during long-lived runs | self | Storage | fg-44-agent-storage-lifecycle | open |
| D8 | Full workspace inventory (sizes/ages/disk metrics) | self | Storage | fg-44-agent-storage-lifecycle | open |
| D9 | Automatic dead-letter after N failed attempts (FR8) | self | Reliability | none | open |
| D10 | Explicit force-clean-restart operator action (FR10) | self | Operability | none | open |
| D11 | Cross-host run migration | self | Scope | none | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Automatic dead-letter vs manual-only for FR8 | implement now / defer | Defer until fg-38 budgets give a durable stop signal | Deferred |
| 2 | Force-clean-restart action for FR10 | implement now / manual runbook | Manual runbook for slice 3 | Deferred |

## Completion gate

- [x] Every `FR*`/`NFR*` acceptance statement in `01` is met for slices 1-3
- [x] Verification matrix in `03` is green and results are recorded
- [x] `status` above is `done` and PR #110 is merged
- [x] Deferred register reflects what was actually left out
