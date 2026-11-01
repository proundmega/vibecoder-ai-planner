# 02_ARCHITECT_DESIGN.md - Flow and Harness Observability (fg-46)

**Status:** planned - **deferred**
**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31, fg-32, fg-33, fg-41

## Design summary

Start with a read-only SQL-backed flow endpoint and a Vue view. Add Prometheus/Grafana only after the end-to-end loop is stable.

```
tickets + ticket_phases + agent_heartbeats + usage_logs + PR data
        |
        v
FlowMetricsService (SQL views / queries)
        |
        +--> GET /api/v1/metrics/flow  (JSON, cheap)
        +--> Prometheus gauges/counters  (later)
        +--> Vue Flow view               (now)
        +--> Grafana dashboards          (later)
        +--> alerts                      (later)
```

## Stage model

```
backlog -> planning -> plan_approved -> assigned -> in_progress -> review
        -> human_approval -> done/merged
```

Collapse for the first dashboard:

- Backlog
- Planning
- In progress
- Review
- Human approval
- Merged

For each: count, p50 age, p95 age, oldest ticket, WIP.

## Data sources

| Source | Use |
|---|---|
| `tickets` | status/phase/created_at/updated_at/priority/project |
| `ticket_phases` | stage transitions and time-in-stage |
| `agent_heartbeats` | agent status/current step/last seen |
| `agents` | pool identity/role |
| `usage_logs` / `agent_actions` | tokens/cost/model |
| `harness_events` (fg-41) | step durations/tool calls |
| PR metadata | review/fix/merge timing |
| host metrics | CPU/RAM/disk/inodes |

## Minimal endpoint

`GET /api/v1/metrics/flow?projectId=...&window=7d`

```json
{
  "stages": [
    { "stage": "backlog", "count": 42, "p50AgeSeconds": 86400, "p95AgeSeconds": 604800, "oldest": "..." }
  ],
  "wip": 12,
  "mergedLast7d": 8,
  "agents": { "busy": 6, "idle": 3, "starting": 1, "failed": 0 },
  "providers": { "requests": 1200, "errors": 3, "p95LatencyMs": 1800, "costUsd": 4.2 },
  "review": { "rounds": 6, "requestChanges": 2, "findings": 11 },
  "merge": { "avgTimeSeconds": 3600, "conflicts": 1 }
}
```

This endpoint can be built with SQL and no external infrastructure.

## Prometheus metrics (Phase 2)

- Gauges: tickets by stage, WIP, agent pool state, disk free/inodes, queue age.
- Counters: merged total, provider requests/errors, review rounds, fix rounds, conflicts, readiness blocks.
- Histograms: stage age, harness step duration, provider latency, merge time.

Use labels sparingly (`project_id`, `stage`, `model`, `outcome`) to avoid cardinality explosion.

## Flow dashboard

A Vue view with:

- stage funnel/cards with counts and p50/p95 age;
- bottleneck highlight (largest oldest count × age);
- agent pool status;
- provider health;
- review/fix rounds;
- storage pressure;
- links to stuck tickets.

The first version should be read-only and refresh every 30–60 seconds.

## Tracing

- Generate `run_id` at ticket pickup.
- Propagate to harness events, ticket messages, agent logs and PR body/metadata.
- Include `ticket_id`, `agent_id`, `project_id`, `stage`, `outcome`.
- Do not include prompts, source contents or secrets.

## Alerts (Phase 3)

| Alert | Condition |
|---|---|
| Stuck ticket | in stage > threshold (e.g. review > 24h) |
| Queue age | p95 backlog age > threshold |
| Provider errors | 5xx/429 rate > 5% for 10 min |
| Disk pressure | free < 20% or inodes < 20% |
| Repeated failures | same ticket failed 3 times |
| Readiness block spike | blocked tickets > threshold |
| Merge conflict spike | conflicts/day > threshold |

## Rollout

### Phase 0 - after end-to-end works
- SQL flow endpoint.
- Vue Flow view.
- Agent pool/provider summary.
- No external stack.

### Phase 1 - stable flow
- Prometheus metrics.
- Grafana dashboard.
- Retention policy.

### Phase 2 - scale
- Alerts.
- Trace IDs.
- Harness event integration (fg-41).
- Provider/model breakdown.

## Open questions

1. Is a JSON endpoint + Vue view enough for the first year?
2. Which stage thresholds define “stuck” per project?
3. Do we need per-model cost in the first version?
4. Should flow metrics be tenant-scoped only or also global for admins?
5. How long do we retain stage events?
6. Do we add Prometheus now because it is cheap, or wait for the flow to stabilize?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-41 | Harness events/replay | Observability | `fg-41-harness-observability` | No |
| 2 | fg-45 | Readiness metrics | Quality | `fg-45-ticket-quality-gates` | No |
| 3 | fg-37 | Evaluation metrics | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-38 | Budget metrics | Billing | `fg-38-harness-budgets-routing` | No |
