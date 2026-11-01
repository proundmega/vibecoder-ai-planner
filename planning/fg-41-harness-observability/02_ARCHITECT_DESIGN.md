# 02_ARCHITECT_DESIGN.md - Harness Observability, Replay and Audit (fg-41)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-33

## Design summary

Emit structured events from the supervisor and OpenCode client into an append-only store. Keep large artifacts separate. Build replay and dashboards from the event stream.

```
HarnessTicketProcessor / OpenCodeClient
  -> EventSink.emit(HarnessEvent)
       -> Redactor
       -> EventStore (Postgres/ClickHouse)
       -> Metrics/Logs (OTel)
       -> ArtifactStore (diff, verification output)

Replay: events + artifacts -> timeline view / verification re-run
```

## Event schema

```json
{
  "version": 1,
  "event_id": "uuid",
  "trace_id": "run-id",
  "run_id": "uuid",
  "ticket_id": "uuid",
  "agent_id": "uuid",
  "session_id": "ses_...",
  "type": "tool.called",
  "timestamp": "2026-10-31T12:00:00Z",
  "payload": {
    "tool": "bash",
    "command_hash": "sha256:...",
    "duration_ms": 120,
    "exit_code": 0
  }
}
```

Event types are versioned; unknown types are stored but not interpreted.

## Redaction

- Keys/tokens/passwords: known patterns + entropy scan.
- `.env` values and secret-like names: drop value, keep hash.
- File edits: store path, line counts and a diff hash by default; full patch only in opt-in verbose mode.
- Prompts: store length/hash and a redacted summary by default.
- Run a final secret scan before persistence; on match, quarantine the event and alert.

## Storage

- Start with Postgres `harness_events` partitioned by day; move to ClickHouse/OpenSearch if volume grows.
- Artifacts in object storage with a retention policy and signed access.
- Indexes: project_id, run_id, ticket_id, type, timestamp (lead with project_id for tenant-scoped queries).
- Retention default 30 days for events, 7 days for artifacts; audit events retained longer.

```sql
CREATE TABLE harness_events (
  event_id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  run_id UUID REFERENCES harness_runs(id) ON DELETE SET NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Replay

- Timeline view: steps, tools, edits, tests, diff, publish.
- "Re-run verification" executes the recorded commands against the recorded SHA in a sandbox; does not call the model.
- "Replay prompt" is opt-in and budgeted; it may produce a different result and must be labeled as a new run.
- Compare two runs by trace id.

## Dashboards and alerts

Dashboards:
- runs/day, success/failure, p50/p95 duration;
- tokens/cost per ticket/project/model;
- stuck runs and dead letters;
- review rounds and fix rounds;
- tool call distribution and failures;
- secret-scan hits.

Alerts:
- run heartbeat stale > lease;
- failure rate spike;
- cost/day above threshold;
- repeated same failure;
- secret pattern detected;
- diff above safety cap.

## Audit

- Immutable events for publish, review request, approval, merge, rollback, credential mint/revoke.
- Include actor (agent/human), reason, before/after SHA, PR id.
- Access is project-scoped; export is permissioned.

## Tests

- event ordering and idempotent emission;
- redaction of keys, tokens and `.env`;
- tenant isolation and access control;
- retention/deletion;
- replay timeline and verification re-run;
- alert triggers.

## Rollout

1. Emit events to logs only.
2. Persist events with redaction.
3. Add replay timeline.
4. Add dashboards.
5. Add alerts.
6. Move to a dedicated store if volume requires.

## Open questions

1. Postgres vs ClickHouse vs OpenSearch?
2. How much prompt/file content can we retain safely?
3. Do we need OpenTelemetry spans end-to-end?
4. How long do audit events need to be retained?
5. Should agents see their own past events for learning?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-33 | Durable run state | Reliability | `fg-33-durable-harness-execution` | No |
| 2 | fg-38 | Budget dashboards | Billing | `fg-38-harness-budgets-routing` | No |
| 3 | fg-42 | Retention/redaction policy | Privacy | `fg-42-harness-privacy` | No |
| 4 | bp-106 | Log aggregation transport | Observability | `bp-106` follow-up | No |
