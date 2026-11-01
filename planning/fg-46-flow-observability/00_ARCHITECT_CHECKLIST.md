# 00_ARCHITECT_CHECKLIST.md - Flow and Harness Observability (fg-46)

**Status:** planned - **deferred**
**Priority:** P2 - after the project completes a full build -> review -> fix -> merge cycle
**Date:** 2026-10-31
**Depends on:** fg-30, fg-31, fg-32, fg-33, fg-41
**Related code:** `backend/src/metrics.js`, `middleware/slowRequest.js`, `HeartbeatService`, `Dashboard.vue`, `AgentList.vue`, `ticket_phases`, `usage_logs`

## Why this ticket exists

The system has infrastructure metrics and agent heartbeats, but no way to answer “where is work piling up?” or “which stage is the bottleneck?” The answer requires flow metrics (queue depth/age by stage), harness stage timings, provider saturation, review/fix rounds and merge time.

**This is wanted, but it is intentionally lower priority than making the full cycle work.** A working end-to-end loop is more valuable than perfect visibility into a loop that does not yet finish.

## Checklist

- [ ] Confirm the end-to-end cycle (build -> review -> fix -> merge) works first
- [ ] Define the flow stages and metric definitions
- [ ] Add a minimal `/metrics/flow` JSON endpoint backed by SQL
- [ ] Add Prometheus counters/histograms for agent and harness stages
- [ ] Add provider latency/error/token metrics
- [ ] Add review/fix/merge metrics
- [ ] Add agent pool and storage metrics
- [ ] Add a Flow dashboard in the UI
- [ ] Add Prometheus/Grafana (or keep the JSON view if enough)
- [ ] Add alerts for stuck tickets, provider errors and disk pressure
- [ ] Add a run/trace ID across agent, harness, ticket and PR
- [ ] Keep the first version read-only and cheap to operate
