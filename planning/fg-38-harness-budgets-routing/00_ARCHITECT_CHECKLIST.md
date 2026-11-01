# 00_ARCHITECT_CHECKLIST.md - Harness Budgets and Model Routing (fg-38)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1
**Related code:** `HarnessConfig`, `OpenCodeClient`, `HarnessTicketProcessor`, usage/billing APIs

## Why this ticket exists

fg-30 defines budget defaults (45 min, 1.5M tokens, $5, 100 tool calls), but nothing enforces them. There is no live token meter, no hard stop, no per-project quota, and no policy for choosing Beam Free vs a paid model or handling a provider outage.

## Checklist

- [ ] Define what is metered and where the numbers come from
- [ ] Add a live budget tracker fed by OpenCode events
- [ ] Enforce hard stops at safe checkpoints and kill the session on breach
- [ ] Add per-ticket, per-project and per-agent quotas
- [ ] Define model routing policy and fallback/circuit breaker
- [ ] Link usage to tickets, runs and billing
- [ ] Add cost/token dashboards and alerts
- [ ] Test breach, fallback, price calculation and concurrency
