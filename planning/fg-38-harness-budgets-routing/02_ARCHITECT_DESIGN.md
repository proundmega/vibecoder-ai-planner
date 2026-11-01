# 02_ARCHITECT_DESIGN.md - Harness Budgets and Model Routing (fg-38)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1

## Design summary

Add a `BudgetTracker` to the supervisor and a `ModelRouter` decision point before session creation. The tracker consumes OpenCode events and enforces limits; the router picks a model and records the reason.

```
HarnessTicketProcessor
  -> ModelRouter.select(task, project, remainingBudget, providerHealth)
  -> OpenCodeClient.start(model)
  -> BudgetTracker.consume(event)
       -> warn at 80%
       -> stop at 100% (kill session, no publish)
  -> UsageStore.record(ticket, run, model, tokens, cost)
```

## Budget model

```java
record BudgetLimits(
    Duration maxDuration,
    long maxInputTokens,
    long maxOutputTokens,
    BigDecimal maxCostUsd,
    int maxToolCalls,
    int maxRetries
) {}
```

A run consumes:
- wall-clock time from start to finish (including verification);
- input/output/cached tokens per model call;
- cost from a versioned price table;
- tool calls from OpenCode events;
- retries (each retry reuses the same budget).

Defaults: 45 min, 1.5M tokens, $5, 100 tool calls, 2 retries (tune per project).

## Metering

- Subscribe to OpenCode events before the prompt.
- Read usage from message/step events; fall back to provider response metadata if events lack it.
- Count tool calls from tool events.
- Persist incremental usage so a crash still leaves a record (fg-33).
- If metering is unavailable for a paid model, fail closed before starting.

## Enforcement

| Threshold | Action |
|---|---|
| 80% | Post warning, emit event, continue |
| 100% | Kill session, mark run `budget_exceeded`, release ticket, no publish |
| Verification timeout | Kill process tree, fail |
| Retry limit | Dead letter / human escalation |
| Project daily quota | Reject new runs, alert |

Hard stops happen before publishing and after each checkpoint; never rely on the model to stop itself.

## Model routing

Policy inputs:

- task complexity (ticket size, files likely touched, planning docs);
- repo size/language;
- remaining budget;
- provider health/circuit breaker;
- project policy (`free_only`, `free_then_paid`, `paid_for_complex`).

Decision record:

```json
{
  "selected": "opencode-go/beam-free",
  "fallback": "opencode-go/paid-model",
  "reason": "small ticket, free model healthy",
  "budget_remaining_usd": 4.20
}
```

Fallback:

- retry once on transient provider errors;
- open the circuit after N consecutive failures;
- fall back to paid only if the project allows it and the budget covers it;
- otherwise fail cleanly and leave the ticket for a human.

## Quotas and concurrency

- `project_budget_daily`, `agent_max_concurrent_runs`, `project_max_concurrent_runs`.
- Enforce at claim time and at every model call.
- Use DB counters or Redis with atomic increments.
- A global/project kill switch blocks new claims and can signal active runs to stop.

## Data model

```sql
CREATE TABLE harness_usage (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES harness_runs(id) ON DELETE SET NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  config_hash TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cached_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  tool_calls INT NOT NULL DEFAULT 0,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE model_prices (
  model TEXT PRIMARY KEY,
  input_per_million NUMERIC,
  output_per_million NUMERIC,
  cached_per_million NUMERIC,
  effective_from TIMESTAMPTZ NOT NULL
);
```

## Tests

- budget warning/stop at each dimension;
- cost calculation with cached tokens;
- paid fallback only when allowed;
- provider circuit breaker;
- concurrent quota race;
- metering failure fails closed;
- kill switch stops new and active runs.

## Rollout

1. Meter only, no enforcement; compare with provider invoices.
2. Enable soft warnings.
3. Enable hard stops per project.
4. Enable routing and fallback.
5. Enable quotas and kill switch.
6. Add dashboards/alerts.

## Open questions

1. Do OpenCode events reliably expose token usage across providers?
2. How often do price tables change, and who owns them?
3. Is the free model suitable for review/fix, or only build?
4. Should budget breach trigger a human question instead of a hard fail?
5. How do we handle prepaid vs postpaid billing?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-37 | Quality-aware routing | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 2 | fg-41 | Budget dashboards | Observability | `fg-41-harness-observability` | No |
| 3 | fg-33 | Durable usage checkpoints | Reliability | `fg-33-durable-harness-execution` | No |
| 4 | bp-04 | Billing aggregation | Billing | `bp-04` follow-up | No |
