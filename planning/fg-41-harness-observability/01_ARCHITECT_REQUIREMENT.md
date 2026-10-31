# 01_ARCHITECT_REQUIREMENT.md - Harness Observability, Replay and Audit (fg-41)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-33 durable execution
**Related code:** `HarnessEvent`, `HarnessTicketProcessor`, `AgentApp`, logging/metrics

## Problem

When a harness run fails or produces a bad PR, operators currently have:

- container logs from multiple threads/processes;
- a heartbeat step string;
- ticket messages;
- the final diff.

There is no structured timeline of what the agent did, which tools it called, what it read, how many tokens it used, or why it stopped. There is no replay and no immutable audit of publish/review/merge actions.

## Goals

1. Emit a structured, versioned event stream per run.
2. Correlate events across ticket, run, agent, session and commit.
3. Persist events with bounded retention and redaction.
4. Replay a failed run from events plus artifacts.
5. Provide dashboards for throughput, failures, cost and review/fix rounds.
6. Alert on stuck runs, cost spikes and suspected secret leakage.
7. Keep an immutable audit trail for publish/review/merge/rollback.
8. Avoid logging secrets or full sensitive file contents.

## Non-goals

- Full packet/trace capture of the container runtime.
- Replacing the platform logging stack.
- Storing complete model conversations forever.
- Real-time UI streaming in Phase 1.

## Functional requirements

- **FR1 - Event schema:** `event_id`, `run_id`, `ticket_id`, `agent_id`, `session_id`, `type`, `timestamp`, `payload`, `version`.
- **FR2 - Event types:** run.started, step.changed, prompt.sent, tool.called, file.edited, verification.result, diff.collected, publish.started, pr.opened, review.result, fix.requested, budget.warning, run.failed, run.succeeded.
- **FR3 - Correlation:** trace id shared by all events in a run; commit SHA and PR number on publish events.
- **FR4 - Redaction:** keys, tokens, passwords, `.env` values and long file contents are redacted at emission.
- **FR5 - Storage:** append-only event store with retention; artifacts (diff, logs) stored separately and referenced.
- **FR6 - Replay:** reconstruct the timeline and artifacts for a run; optionally re-run verification without the model.
- **FR7 - Dashboards:** runs/day, success rate, p50/p95 duration, cost/tokens, stuck runs, review/fix rounds.
- **FR8 - Alerts:** stuck run, repeated failure, budget breach, secret pattern, abnormal diff size.
- **FR9 - Audit:** immutable publish/review/merge/rollback events with actor and reason.
- **FR10 - Access:** project-scoped visibility; agents cannot read other projects' events.

## Safety requirements

- Never store raw provider keys, GitHub tokens or server passwords.
- Do not store complete source files or full prompts by default; store hashes/summaries with opt-in verbose mode.
- Event access is tenant-scoped and permission-checked.
- Audit events are append-only.
- Retention/deletion complies with fg-42.

## Acceptance criteria

1. Every run has a complete, ordered event timeline.
2. Events are correlated by run/trace and include commit/PR ids.
3. Secrets are redacted in events, logs and artifacts.
4. A failed run can be replayed (timeline + diff + verification).
5. Dashboards and alerts cover stuck runs, failures and cost.
6. Publish/review/merge actions have immutable audit records.
7. Retention and tenant isolation are enforced.
8. Tests cover ordering, redaction, retention, replay and access control.

## Out of scope

- Distributed tracing of the model provider.
- Full conversation archival.
- Real-time event streaming UI.
- Compliance certification.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-33 | Durable run/checkpoint state | Reliability | `fg-33-durable-harness-execution` | No |
| 2 | fg-38 | Budget metrics and alerts | Billing | `fg-38-harness-budgets-routing` | No |
| 3 | fg-42 | Retention/redaction policy | Privacy | `fg-42-harness-privacy` | No |
| 4 | bp-106 | Reuse log aggregation transport | Observability | `bp-106` follow-up | No |
