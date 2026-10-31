# 01_ARCHITECT_REQUIREMENT.md - Harness Budgets and Model Routing (fg-38)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1
**Related code:** `HarnessConfig`, `OpenCodeClient`, `HarnessTicketProcessor`, usage/billing APIs

## Problem

The harness can consume a lot of time and money:

- long prompts and large repos;
- many tool calls;
- paid model fallbacks;
- retries after failure;
- review/fix loops;
- multiple concurrent tickets.

fg-30 has defaults, but they are configuration values, not enforcement. There is no live meter, no hard stop, no per-project quota, and no routing policy. A single runaway session can exhaust a budget without anyone noticing.

## Goals

1. Meter time, tokens, cost and tool calls during a run.
2. Enforce hard limits and stop the session before overspend.
3. Allocate budgets per ticket, project and agent.
4. Route simple work to the free model and complex work to a paid model.
5. Fall back safely on provider errors, rate limits or outages.
6. Attribute usage to ticket/run/project for billing and reporting.
7. Alert before/at breach.
8. Keep the policy configurable per project.

## Non-goals

- Replacing the billing system.
- Dynamic pricing negotiation.
- Training a cost-prediction model.
- Budget enforcement for non-harness agents (covered elsewhere).

## Functional requirements

- **FR1 - Meter:** consume token/tool events from OpenCode and track wall-clock and verification time.
- **FR2 - Cost:** price input/output/cached tokens per model; include review/fix rounds.
- **FR3 - Hard stop:** at 100% of any budget, stop the session, release the ticket, and post a clear message.
- **FR4 - Soft warning:** at 80%, post a warning and emit an event.
- **FR5 - Quotas:** per-ticket, per-project/day, per-agent concurrency and spend.
- **FR6 - Routing:** choose a model from a policy (task complexity, repo size, budget remaining, provider health).
- **FR7 - Fallback:** free -> paid only when allowed; circuit-break a failing provider; never silently exceed budget.
- **FR8 - Attribution:** store usage with ticket, run, project, agent, model and prompt version.
- **FR9 - Retry policy:** a retry consumes the same budget; cap retries.
- **FR10 - Kill switch:** a project/global switch stops new runs and can terminate active ones.

## Safety requirements

- Budget checks must be fail-closed: if metering is unavailable, do not start a paid run.
- A budget breach must not publish partial work.
- Price tables must be versioned and auditable.
- No keys or billing data in logs.
- Concurrent runs must not exceed the project quota.

## Acceptance criteria

1. A run stops at the configured time/token/cost/tool limit and does not publish.
2. Usage is attributed to the ticket/run/project.
3. The router chooses free vs paid per policy and records why.
4. A provider outage triggers fallback or a clean failure, not a loop.
5. Project quotas are enforced across concurrent agents.
6. A kill switch stops new work immediately.
7. Tests cover breach, warning, fallback, pricing and quota races.

## Out of scope

- Prepaid wallet implementation.
- Chargeback/invoicing.
- Per-user budgets.
- Model quality routing based on evaluation (fg-37 can feed it later).

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-37 | Use eval quality to inform routing | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 2 | fg-41 | Budget/token dashboards | Observability | `fg-41-harness-observability` | No |
| 3 | fg-33 | Budget-aware recovery | Reliability | `fg-33-durable-harness-execution` | No |
| 4 | bp-04 | Reuse usage/billing aggregation | Billing | `bp-04` follow-up | No |
