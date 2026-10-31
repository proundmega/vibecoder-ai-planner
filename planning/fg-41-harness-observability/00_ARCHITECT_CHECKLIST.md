# 00_ARCHITECT_CHECKLIST.md - Harness Observability, Replay and Audit (fg-41)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-33 durable execution
**Related code:** `HarnessEvent`, `HarnessTicketProcessor`, `AgentApp`, logging/metrics

## Why this ticket exists

The harness emits sparse logs and heartbeat steps. There is no structured per-run event stream, no trace correlation, no replay, and no immutable audit trail. Debugging a failed ticket means reading interleaved container logs.

## Checklist

- [ ] Define the harness event schema and versioning
- [ ] Add run/trace correlation IDs
- [ ] Persist events with bounded retention
- [ ] Add replay of a failed run (events + diff + verification)
- [ ] Add dashboards for runs, failures, cost, review/fix rounds
- [ ] Add alerts for stuck runs, secret leakage and cost spikes
- [ ] Add immutable audit events for publish/review/merge
- [ ] Define redaction at the event boundary
- [ ] Test ordering, retention, redaction and replay
