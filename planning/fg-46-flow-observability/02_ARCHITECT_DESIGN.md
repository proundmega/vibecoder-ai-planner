# 02_ARCHITECT_DESIGN.md - Flow and Harness Observability (fg-46)

**Status:** planned - **deferred**
**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31, fg-32, fg-33, fg-36 (merge timestamps), fg-41, fg-44 (storage metrics); fg-45 optional for readiness metrics

## Design summary

Start with a read-only SQL-backed flow endpoint and a Vue view. Add Prometheus/Grafana only after the end-to-end loop is stable.

```
tickets + approval_requests + ticket_phases + ticket_review_* + ticket_fix_requests
        + agent_heartbeats + usage_logs + harness_runs/harness_events + fg-44 host metrics
        |
        v
FlowMetricsService.deriveStage(ticket) + SQL aggregation
        |
        +--> GET /api/v1/metrics/flow  (JSON, JWT + project membership)
        +--> Prometheus gauges/counters  (later)
        +--> Vue Flow view               (now)
        +--> Grafana dashboards          (later)
        +--> alerts                      (later)
```

## Stage model

`tickets.phase` is not reliable: agents pick up by writing `status` only (`TicketService.pickUpTicket`), `Ticket.updateStatus` writes only `status`, and `ticket_phases` is written only by `PhaseService.transition`. The canonical stage is derived from columns that the normal flow actually updates.

`deriveStage(ticket, latestApproval)` — first match wins:

| # | Condition | Stage |
|---|---|---|
| 1 | `status='done'` (and `pr_state='merged'` once fg-36 tracks it) | `done` (`merged` when known) |
| 2 | `review_state IN ('changes_requested','fixing')` | `in_progress` (substate `fix`) |
| 3 | pending row in `approval_requests` for the ticket | `human_approval` |
| 4 | `status='review'` | `review` |
| 5 | `status='in_progress'` | `in_progress` |
| 6 | `status='backlog'` and `assigned_agent_id IS NOT NULL` | `assigned` |
| 7 | `status='backlog'` and `ready_at IS NOT NULL` | `ready` |
| 8 | `status='backlog'` and (`planning_status IN ('template_selected','in_progress')` or `phase IN ('planning','plan_approved')) | `planning` |
| 9 | otherwise | `backlog` |

Notes:

- Rows 1-5 use status first because that is the only field every path writes.
- `phase` is a tie-breaker for `backlog` tickets only; it never overrides an active status.
- `review` and `human_approval` both map to `status=review`, so the approval lookup is what separates them.
- `ticket_phases` is used only for **history** (time-in-stage, transition counts), never to compute the current stage.
- If fg-45 lands, `status=backlog` + `ready_at IS NULL` + no planning template = `backlog`; readiness issues are surfaced separately.

Collapse for the first dashboard: Backlog, Planning, Ready, In progress, Review, Human approval, Done. `assigned` folds into In progress for the summary, and `fix` is a badge on In progress.

For each: count, p50 age, p95 age, oldest ticket, WIP.

## Data sources

| Source | Status | Use |
|---|---|---|
| `tickets` | exists | status, phase, planning_status, ready_at, pr fields, created_at/updated_at, priority, project |
| `approval_requests` | exists (`003_role_system.sql`) | human approval presence/timing |
| `ticket_phases` | exists | historical transitions, approximate time-in-stage |
| `agent_heartbeats` | exists | agent status/current step/last seen |
| `agents` | exists | pool identity/role |
| `usage_logs` / `agent_actions` | exists | tokens/cost/model |
| `ticket_review_attempts`, `ticket_review_findings` | fg-31 | review rounds/findings |
| `ticket_fix_requests`, `tickets.review_state` | fg-32 | fix rounds/escalations |
| `harness_runs`, `harness_events` | fg-33 / fg-41 | run timings and step durations |
| host disk/inode metrics | fg-44 | storage pressure |
| PR merge timestamp/state | fg-36 | merge time/conflicts/stale PRs |

Explicitly **not** available today:

- no PR table; `tickets.pr_state`/`pr_url` are set only when the PR is created (`GitHubService.js:138-141`), with no merge timestamp or webhook;
- no agent queue, so `agent_queue_wait_seconds` is not computable (PoolManager throws at capacity);
- provider latency/error counters are not recorded.

Phase 0 returns `null` for these and the UI shows “not instrumented” instead of a misleading number.

## Minimal endpoint

`GET /api/v1/metrics/flow?projectId=...&window=7d`

```json
{
  "generatedAt": "2026-11-02T10:00:00Z",
  "window": "7d",
  "stages": [
    { "stage": "backlog", "count": 42, "p50AgeSeconds": 86400, "p95AgeSeconds": 604800, "oldest": "..." }
  ],
  "wip": 12,
  "doneLast7d": 8,
  "mergeKnown": false,
  "agents": { "busy": 6, "idle": 3, "starting": 1 },
  "providers": { "tokens": 1200, "costUsd": 4.2, "latency": null },
  "review": { "rounds": 6, "requestChanges": 2, "findings": 11 },
  "merge": { "avgTimeSeconds": null, "conflicts": null },
  "storage": { "diskFreeBytes": 812345678901, "inodesFree": 1234567 },
  "readiness": { "blocked": 3, "topCodes": ["DESCRIPTION_TOO_SHORT"] }
}
```

`mergeKnown: false` documents which fields are unavailable; the UI renders an explanation instead of `0`.

### Auth

- Route lives under the existing `/api/v1` router with `verifyToken` + `requireAnyPermission('DASHBOARD_READ')`.
- If `projectId` is given, also assert project membership (owner, member, or project agent) — same check used by ticket routes.
- Global (no `projectId`) requires `super_admin`.
- The browser uses the existing `vibecode_token` from localStorage; `METRICS_TOKEN` is **not** used here.
- The Prometheus `/metrics` endpoint (`backend/src/index.js:78-87`) keeps its optional `X-Metrics-Token` scrape auth, unchanged. The two channels do not share credentials.
- Query params are validated with Joi (`projectId` optional, `window` one of `24h|7d|30d|90d`); no arbitrary SQL inputs.

### Query shape

- Compute in SQL where possible (`GROUP BY deriveStage` equivalent via `CASE`), and keep `deriveStage` only in `FlowMetricsService` so tests and SQL cannot drift. Phase 0 may fetch a bounded window of tickets and derive in JS, then cache for 30-60s.
- Bound the result with `LIMIT` and a project filter; no full-table scans without `project_id`.

## Prometheus metrics (Phase 2)

- Gauges: tickets by stage, WIP, agent pool state (busy/idle/starting), disk free/inodes, oldest ticket age per stage.
- Counters: done total, provider requests/errors (once instrumented), review rounds, fix rounds, readiness blocks.
- Histograms: stage age, harness step duration, provider latency, merge time (after fg-36).

Use labels sparingly (`project_id`, `stage`, `model`, `outcome`) to avoid cardinality explosion.

## Flow dashboard

A Vue view with:

- stage funnel/cards with counts and p50/p95 age;
- bottleneck highlight (largest oldest count × age);
- agent pool status;
- provider health;
- review/fix rounds;
- storage pressure;
- “not instrumented” states for merge/queue/latency;
- links to stuck tickets.

The first version should be read-only and refresh every 30–60 seconds.

## Tracing

- **Do not generate a new ID.** `run_id` is the `harness_runs.id` defined by fg-33 and used by fg-41.
- If a ticket has no run row (legacy one-shot path), `run_id` is `null` and the trace view falls back to `ticket_id`.
- Propagation targets:
  - ticket message metadata (`ticket_messages.metadata.run_id`);
  - agent log MDC field and HTTP header (`X-Run-Id`);
  - `harness_events.run_id` (fg-41);
  - PR body marker `<!-- vibecode-run: <uuid> -->` (marker only, no secrets).
- Include `ticket_id`, `agent_id`, `project_id`, `stage`, `outcome`.
- Do not include prompts, source contents or secrets.

## Alerts (Phase 3)

| Alert | Condition |
|---|---|
| Stuck ticket | stage age > threshold (e.g. review > 24h) |
| Queue age | p95 backlog/ready age > threshold |
| Provider errors | 5xx/429 rate > 5% for 10 min (after instrumentation) |
| Disk pressure | free < 20% or inodes < 20% |
| Repeated failures | same ticket failed 3 times |
| Readiness block spike | blocked tickets > threshold (fg-45) |
| Merge conflict spike | conflicts/day > threshold (fg-36) |

## Rollout

### Phase 0 - after end-to-end works
- `deriveStage` + SQL flow endpoint (JWT + membership).
- Vue Flow view.
- Stage counts/ages, agent pool, tokens/cost, review/fix from fg-31/32.
- `null` for merge/queue/provider-latency; no external stack.

### Phase 1 - stable flow
- Prometheus metrics.
- Grafana dashboard.
- Retention policy.

### Phase 2 - scale
- Alerts.
- `run_id` propagation through fg-41 events.
- Provider/model breakdown and latency instrumentation.
- Merge/conflict metrics once fg-36 lands.

## Open questions

1. Is a JSON endpoint + Vue view enough for the first year?
2. Which stage thresholds define “stuck” per project?
3. Do we need per-model cost in the first version?
4. Should pickup/status writes also emit `ticket_phases` rows for exact history?
5. How long do we retain stage events?
6. Do we add Prometheus now because it is cheap, or wait for the flow to stabilize?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-41 | Harness events/replay | Observability | `fg-41-harness-observability` | No |
| 2 | fg-45 | Readiness metrics | Quality | `fg-45-ticket-quality-gates` | No |
| 3 | fg-37 | Evaluation metrics | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-38 | Budget metrics | Billing | `fg-38-harness-budgets-routing` | No |
