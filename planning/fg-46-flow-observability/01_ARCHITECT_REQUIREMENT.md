# 01_ARCHITECT_REQUIREMENT.md - Flow and Harness Observability (fg-46)

**Status:** planned - **deferred**
**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31, fg-32, fg-33, fg-41
**Related code:** `backend/src/metrics.js`, `middleware/slowRequest.js`, `HeartbeatService`, `Dashboard.vue`, `AgentList.vue`

## Priority and sequencing

We want this observability, but **we will prioritize making the project work end-to-end before adding it**. Completing a full cycle is more important than knowing exactly what is happening inside an incomplete cycle.

Sequencing:

1. Make build -> review -> fix -> merge work reliably.
2. Add the cheap, read-only flow endpoint and UI view.
3. Add Prometheus/Grafana and alerts once the flow is stable.
4. Add deep tracing/replay after the basics are trusted.

This ticket should not block fg-30/fg-31/fg-32 delivery.

## Current state

What exists:

- `/metrics` with Prometheus default process metrics, DB pool gauges, HTTP duration/count.
- `slowRequest`/`requestLogger` with method/path/status/duration.
- `agent_heartbeats`: last_seen, current ticket, current step, memory/cpu JSON, online/offline.
- `/api/v1/agents-status`; Dashboard online/idle/offline counts; AgentList heartbeat tab.
- `usage_logs`, agent actions/cost, billing dashboard.
- `ticket_phases` history.

What is missing:

- no queue depth/age by status or phase;
- no WIP/throughput/cycle-time view;
- no per-stage harness timings;
- no provider latency/error/rate-limit metrics;
- no review/fix round metrics;
- no merge/conflict metrics;
- no agent pool busy/idle/starting/failed metrics beyond heartbeat status;
- no storage/inode/workspace metrics;
- no Prometheus/Grafana/Loki/OTel stack in compose;
- no alerts;
- no end-to-end run/trace ID.

## Goals

1. Show where work is piling up: backlog, planning, in progress, review, human approval, merge.
2. Show agent pool capacity and utilization.
3. Show provider health and cost.
4. Show review/fix loop behavior.
5. Show stage timings and failure rates.
6. Alert on stuck tickets, provider errors, disk pressure and repeated failures.
7. Correlate a ticket across agent, harness, messages and PR with a `run_id`.
8. Start cheap; grow into Prometheus/Grafana only when the flow is stable.

## Non-goals

- Full APM or distributed tracing of the model provider.
- Replacing logs.
- Per-request tracing in Phase 1 of this ticket.
- Long-term analytics/data warehouse.
- Observability before the end-to-end loop works.

## Functional requirements

- **FR1 - Flow view:** counts and p50/p95 age per stage (backlog, planning, in_progress, review, human_approval, merged).
- **FR2 - Throughput:** tickets completed/merged per day/week; WIP.
- **FR3 - Stage timing:** time in each phase and each harness step (claim, clone, prompt, verify, publish).
- **FR4 - Agent pool:** busy, idle, starting, failed, queue wait, host capacity.
- **FR5 - Provider:** request rate, p95 latency, 4xx/5xx/429, tokens and cost per model.
- **FR6 - Review/fix:** review rounds, request-changes rate, findings by severity, fix rounds, escalations.
- **FR7 - Merge:** time to approval, merge time, conflict rate, stale PRs.
- **FR8 - Storage:** disk/inode usage, workspace bytes, idle refreshes.
- **FR9 - Alerts:** stuck ticket, queue age, provider error spike, disk > 80%, repeated failed runs.
- **FR10 - Trace ID:** `run_id` propagated through agent logs, harness events, ticket messages and PR metadata.
- **FR11 - Minimal path:** a SQL-backed JSON endpoint + Vue view that works without Prometheus/Grafana.
- **FR12 - Retention:** bounded retention for metrics/events; no unbounded growth.

## Metric definitions

| Metric | Definition |
|---|---|
| `tickets_by_stage{stage}` | Current ticket count per stage |
| `ticket_age_seconds{stage}` | p50/p95 time in stage |
| `tickets_merged_total` | Merged tickets per period |
| `wip` | Tickets in planning/in_progress/review |
| `agent_pool{state}` | busy/idle/starting/failed |
| `agent_queue_wait_seconds` | Time waiting for an agent |
| `harness_step_duration_seconds{step}` | claim/clone/prompt/verify/publish |
| `provider_requests_total{model,status}` | Provider requests |
| `provider_latency_seconds{model}` | p50/p95 latency |
| `provider_tokens_total{model,type}` | Input/output/cached tokens |
| `review_rounds` | Reviewer request-changes count |
| `review_findings_total{severity}` | Findings |
| `fix_rounds` | Fixer rounds per ticket |
| `merge_time_seconds` | Approval -> merge |
| `merge_conflicts_total` | Dirty/conflicted PRs |
| `disk_free_bytes`, `inodes_free` | Host storage |
| `tickets_blocked_by_readiness_total` | Readiness gate blocks (fg-45) |

## Safety requirements

- Observability must not expose secrets, prompts or source content.
- Per-project access control on dashboards.
- Metrics endpoints auth (`METRICS_TOKEN`) in production.
- Alerts must not page on expected idle periods without a sustained window.
- Tracing IDs must not include sensitive values.

## Acceptance criteria

1. A Flow view shows counts and p50/p95 age per stage.
2. The view identifies the current bottleneck stage in one glance.
3. Agent pool and provider metrics are visible.
4. Review/fix/merge metrics are visible.
5. Stuck-ticket and disk alerts fire in a test scenario.
6. A ticket can be followed by `run_id` across agent, harness, messages and PR.
7. The minimal version works without Prometheus/Grafana.
8. Promotion to Prometheus/Grafana requires no schema changes.
9. The feature is explicitly marked deferred until the end-to-end cycle works.

## Out of scope

- APM/trace sampling of every HTTP request.
- ML anomaly detection.
- Customer-facing analytics.
- Long-term billing reconciliation.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-41 | Structured harness events and replay | Observability | `fg-41-harness-observability` | No |
| 2 | fg-45 | Readiness and blocked-ticket metrics | Quality | `fg-45-ticket-quality-gates` | No |
| 3 | fg-37 | Quality metrics from evaluation | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-38 | Cost/budget metrics | Billing | `fg-38-harness-budgets-routing` | No |
