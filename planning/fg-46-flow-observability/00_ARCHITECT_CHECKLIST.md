---
id: "fg-46"
title: "Flow and Harness Observability"
status: deferred
priority: "P2 - after the project completes a full build -> review -> fix -> merge cycle"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-31", "fg-32", "fg-33", "fg-36", "fg-41", "fg-44", "fg-45"]
---

# 00 — Flow and Harness Observability (fg-46)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Related code:** `backend/src/metrics.js`, `middleware/slowRequest.js`, `HeartbeatService`, `PhaseService`, `approval_requests`, `ticket_phases`, `usage_logs`, `Dashboard.vue`, `AgentList.vue`

## Why this ticket exists

The system has infrastructure metrics and agent heartbeats, but no way to answer “where is work piling up?” or “which stage is the bottleneck?” The answer requires flow metrics (queue depth/age by stage), harness stage timings, provider saturation, review/fix rounds and merge time.

**This is wanted, but it is intentionally lower priority than making the full cycle work.** A working end-to-end loop is more valuable than perfect visibility into a loop that does not yet finish.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Quality metrics from evaluation | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D2 | Cost/budget metrics | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D3 | Structured harness events and replay | fg-41 | Observability | fg-41-harness-observability | open |
| D4 | Readiness and blocked-ticket metrics | fg-45 | Quality | fg-45-ticket-quality-gates | open |

## Important design decisions

1. `deriveStage` is authoritative; SQL never re-derives stages independently.
2. `tickets.phase`/`ticket_phases` are history, not current truth, because the normal path writes only `status`.
3. Unmeasurable metrics are `null` with a reason, never `0`.
4. `run_id` is the fg-33 run ID; legacy runs have `run_id=null`.
5. Two auth channels: user JWT for the UI, `METRICS_TOKEN` for scrapes.

## Known unknowns

- Whether pickup/status should emit `ticket_phases` rows for exact history.
- Per-project stuck thresholds.
- Whether to instrument provider latency/errors in the agent or wait for fg-41.
- Whether Phase 0 needs per-model cost.

## Testing checklist

- [ ] Table-driven `deriveStage` tests (all status/phase/planning/review/approval combinations, including plan_approved-without-ready).
- [ ] Auth: project member 200, outsider 403, agent owner 200, super_admin global 200, token-only 401.
- [ ] Stage counts reconcile with the ticket list.
- [ ] Missing optional tables return `null`.
- [ ] `run_id` propagation matches `harness_runs.id`.
- [ ] Flow view renders counts/ages and the bottleneck highlight.
