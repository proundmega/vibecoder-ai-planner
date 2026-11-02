# 01_ARCHITECT_REQUIREMENT.md - Flow and Harness Observability (fg-46)

**Status:** planned - **deferred**
**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31, fg-32, fg-33, fg-36 (merge timestamps), fg-41, fg-44 (storage metrics), **fg-45 (required: `ready_at`/planning columns)**
**Related code:** `backend/src/metrics.js`, `middleware/slowRequest.js`, `HeartbeatService`, `PhaseService`, `TicketService`, `approval_requests`, `ticket_phases`, `usage_logs`, `Dashboard.vue`, `AgentList.vue`

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
- `ticket_phases` history (written only by `PhaseService.transition`).

What is missing:

- no queue depth/age by status or phase;
- no WIP/throughput/cycle-time view;
- no per-stage harness timings;
- no provider latency/error/rate-limit metrics;
- no review/fix round metrics;
- no merge/conflict metrics (no merge timestamp or webhook before fg-36);
- no agent pool busy/idle/starting metrics beyond heartbeat status;
- no storage/inode/workspace metrics;
- no Prometheus/Grafana/Loki/OTel stack in compose;
- no alerts;
- no end-to-end run/trace ID.

**Critical:** the normal agent path writes only `tickets.status`. `tickets.phase` stays `draft` unless someone calls `PhaseService`, and `ticket_phases` is written only there. Any stage model that trusts `phase` alone will misclassify active tickets.

## Goals

1. Show where work is piling up: backlog, planning, ready, in progress, review, human approval, done.
2. Show agent pool capacity and utilization.
3. Show provider health and cost.
4. Show review/fix loop behavior.
5. Show stage timings and failure rates.
6. Alert on stuck tickets, provider errors, disk pressure and repeated failures.
7. Correlate a ticket across agent, harness, messages and PR with the fg-33 `run_id`.
8. Start cheap; grow into Prometheus/Grafana only when the flow is stable.

## Non-goals

- Full APM or distributed tracing of the model provider.
- Replacing logs.
- Per-request tracing in Phase 1 of this ticket.
- Long-term analytics/data warehouse.
- Observability before the end-to-end loop works.
- Inventing a second run identifier.

## Functional requirements

- **FR1 - Flow view:** counts and p50/p95 age per canonical stage (`backlog`, `planning`, `ready`, `assigned`, `in_progress`, `review`, `human_approval`, `done`), derived by `deriveStage(ticket)`. fg-45 is required because `ready_at`/`plan_approved_at` come from it; without those columns the query must not be deployed.
- **FR2 - Throughput:** tickets done per day/week; WIP. Merge counts require fg-36.
- **FR3 - Stage timing:** time in each stage and each harness step (claim, clone, prompt, verify, publish), using `harness_runs`/`harness_events` when present.
- **FR4 - Agent pool:** busy, idle, starting, plus host capacity. `failed` is not emitted until `PoolManager.getStatus()` produces it.
- **FR5 - Provider:** request rate, p95 latency, 4xx/5xx/429, tokens and cost per model. Errors/latency require instrumentation; tokens/cost come from `usage_logs`.
- **FR6 - Review/fix:** review rounds, request-changes rate, findings by severity, fix rounds, escalations from `ticket_review_attempts`, `ticket_review_findings` and `ticket_fix_requests` (fg-31/fg-32).
- **FR7 - Merge:** time to approval, merge time, conflict rate, stale PRs. **Only after fg-36** records merge timestamps/webhooks; Phase 0 returns `null`, not a wrong number.
- **FR8 - Storage:** disk/inode usage, workspace bytes, idle refreshes from fg-44.
- **FR9 - Alerts:** stuck ticket, queue age, provider error spike, disk > 80%, repeated failed runs.
- **FR10 - Trace ID:** reuse `harness_runs.id` (fg-33) as `run_id`; propagate to agent logs, harness events (fg-41), ticket message metadata and the PR body marker. Do not generate a second ID; legacy runs without a run row get `run_id=null`.
- **FR11 - Minimal path:** a read-only JSON endpoint (SQL queries, in-process stage derivation) + Vue view that works without Prometheus/Grafana.
- **FR12 - Retention:** bounded retention for metrics/events; no unbounded growth.
- **FR13 - Auth contract:** the flow endpoint is authorized with a **user JWT** + `DASHBOARD_READ` + the shared `assertProjectMember` helper from fg-45 (owner, `project_memberships`, agent owner; explicit `super_admin` bypass for the global view). `METRICS_TOKEN` stays scoped to the Prometheus `/metrics` scrape and is never sent to the browser.

## Metric definitions

| Metric | Definition | Source |
|---|---|---|
| `tickets_by_stage{stage}` | Current ticket count per `deriveStage` stage | `tickets`, `approval_requests` |
| `ticket_age_seconds{stage}` | p50/p95 time in stage | `ticket_phases` when present, else `updated_at` (approximate, flagged) |
| `tickets_done_total` | Tickets reaching `done` per period. Uses the fg-36 merge timestamp when present; otherwise `tickets.updated_at` (approximate — an edit to a done ticket moves it) | `tickets` / fg-36 |
| `wip` | Tickets in planning/ready/assigned/in_progress/review/human_approval | `deriveStage` |
| `agent_pool{state}` | busy/idle/starting | `agent_heartbeats` + `PoolManager.getStatus()` |
| `agent_queue_wait_seconds` | Time waiting for an agent | **not measured** until a real queue exists (`requestAgent` throws at capacity today) |
| `harness_step_duration_seconds{step}` | claim/clone/prompt/verify/publish | `harness_events` (fg-41) |
| `provider_requests_total{model,status}` | Provider requests | needs instrumentation |
| `provider_latency_seconds{model}` | p50/p95 latency | needs instrumentation |
| `provider_tokens_total{model,type}` | Input/output/cached tokens | `usage_logs` |
| `review_rounds` | Reviewer request-changes count | `ticket_review_attempts` |
| `review_findings_total{severity}` | Findings | `ticket_review_findings` |
| `fix_rounds` | Fixer rounds per ticket | `ticket_fix_requests` |
| `merge_time_seconds` | Approval -> merge | fg-36 merge timestamp |
| `merge_conflicts_total` | Dirty/conflicted PRs | fg-36 |
| `disk_free_bytes`, `inodes_free` | Host storage | fg-44 |
| `tickets_blocked_by_readiness_total{code}` | Readiness gate blocks | fg-45 `ticket_readiness_events` |

## Safety requirements

- Observability must not expose secrets, prompts or source content.
- Per-project access control on the flow endpoint and dashboard: `TICKET_READ`/`DASHBOARD_READ` plus project membership; global view requires `super_admin`.
- `METRICS_TOKEN` protects only the Prometheus `/metrics` scrape; browsers authenticate with the existing user JWT.
- Alerts must not page on expected idle periods without a sustained window.
- Tracing IDs must not include sensitive values.
- `run_id` is the fg-33 run ID; no PII or prompt content in IDs.

## Acceptance criteria

1. A Flow view shows exact counts and p50/p95 age per stage from `deriveStage`; stage counts add up to the project ticket total. Projects above `FLOW_MAX_SCAN_TICKETS` return `truncated: true` with `sampleSize`/`truncatedAt` instead of silently wrong totals.
2. `plan_approved_at` without `ready_at`, `planning_status='review'`, and an expired waiver all classify as `planning`/not-ready rather than `ready`.
3. The view identifies the current bottleneck stage in one glance.
4. Agent pool metrics are visible with busy/idle/starting only.
5. Review/fix metrics come from the fg-31/32 tables; missing tables degrade to `null`, not zero.
6. Merge metrics are `null` until fg-36 is merged; once present, time/conflicts/stale PRs render.
7. A ticket can be followed by the fg-33 `run_id` across agent logs, harness events, ticket messages and PR body.
8. The minimal version works without Prometheus/Grafana.
9. Promotion to Prometheus/Grafana requires no schema changes.
10. The flow endpoint rejects a user without project membership and never accepts `METRICS_TOKEN` as a user credential.
11. The feature is explicitly marked deferred until the end-to-end cycle works.

## Impact analysis

| Area | Impact |
|---|---|
| API | New `/api/v1/metrics/flow` route with JWT + membership auth |
| Database | Read-only in Phase 0; optional fg-41/fg-36/fg-44 tables |
| Frontend | New Flow view; reuses the existing auth store |
| Existing metrics | `/metrics` unchanged; `METRICS_TOKEN` remains scrape-only |
| Agent | No new identifier; `run_id` comes from fg-33 |

## Important design decisions

1. `deriveStage` is a single backend function with documented precedence; the SQL never re-derives stages.
2. `tickets.phase` and `ticket_phases` are history, not current truth.
3. Phase 0 returns `null` for metrics it cannot measure (merge, queue wait, provider latency) rather than fabricated zeros.
4. Reuse the fg-33 `run_id`.
5. Two auth channels with different scopes: JWT for the UI, `METRICS_TOKEN` for scrapes.

## Known unknowns

- Whether pickup/status writes should also emit `ticket_phases` rows (nice for history, not required for Phase 0).
- Which stuck thresholds per project are useful.
- Whether provider latency/errors can be instrumented cheaply in the Java agent or should wait for fg-41.
- Whether per-model cost is needed in the first version.

## Testing checklist

- [ ] `deriveStage` table-driven tests covering every status/phase/planning/review/approval combination.
- [ ] Flow endpoint auth: member of project passes, outsider 403, super_admin global passes, `METRICS_TOKEN` alone 401.
- [ ] Stage counts reconcile with the ticket list.
- [ ] Missing optional tables return `null`, not errors.
- [ ] `run_id` matches `harness_runs.id` and appears in all four propagation targets.
- [ ] Frontend Flow view renders counts/ages and the bottleneck highlight.

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
