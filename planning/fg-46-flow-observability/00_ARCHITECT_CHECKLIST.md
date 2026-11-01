# 00_ARCHITECT_CHECKLIST.md - Flow and Harness Observability (fg-46)

**Status:** planned - **deferred**
**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31, fg-32, fg-33, fg-36, fg-41, fg-44; fg-45 optional
**Related code:** `backend/src/metrics.js`, `middleware/slowRequest.js`, `HeartbeatService`, `PhaseService`, `approval_requests`, `ticket_phases`, `usage_logs`, `Dashboard.vue`, `AgentList.vue`

## Why this ticket exists

The system has infrastructure metrics and agent heartbeats, but no way to answer “where is work piling up?” or “which stage is the bottleneck?” The answer requires flow metrics (queue depth/age by stage), harness stage timings, provider saturation, review/fix rounds and merge time.

**This is wanted, but it is intentionally lower priority than making the full cycle work.** A working end-to-end loop is more valuable than perfect visibility into a loop that does not yet finish.

## Checklist

- [ ] Confirm the end-to-end cycle (build -> review -> fix -> merge) works first
- [ ] Define `deriveStage(ticket)` from status/phase/planning/approvals, with documented precedence
- [ ] Define metric definitions and mark which are not yet measurable
- [ ] Add `GET /api/v1/metrics/flow` with JWT + project-membership auth
- [ ] Keep `METRICS_TOKEN` for the Prometheus `/metrics` scrape only
- [ ] Use fg-31/32 tables for review/fix metrics
- [ ] Use `approval_requests` for human-approval timing
- [ ] Reuse the fg-33 `run_id` (no new identifier)
- [ ] Add `null`/“not instrumented” handling for merge, queue wait and provider latency
- [ ] Add Prometheus counters/histograms (later)
- [ ] Add provider latency/error/token metrics (instrumentation required)
- [ ] Add agent pool and storage metrics (fg-44)
- [ ] Add a Flow dashboard in the UI
- [ ] Add Prometheus/Grafana (or keep the JSON view if enough)
- [ ] Add alerts for stuck tickets, provider errors and disk pressure
- [ ] Keep the first version read-only and cheap to operate

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

- [ ] Table-driven `deriveStage` tests (all status/phase/planning/review/approval combinations).
- [ ] Auth: project member 200, outsider 403, super_admin global 200, token-only 401.
- [ ] Stage counts reconcile with the ticket list.
- [ ] Missing optional tables return `null`.
- [ ] `run_id` propagation matches `harness_runs.id`.
- [ ] Flow view renders counts/ages and the bottleneck highlight.
