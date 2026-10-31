# 01_ARCHITECT_REQUIREMENT.md - Durable Harness Execution (fg-33)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor)
**Related code:** `HarnessTicketProcessor`, `WorkspaceManager`, `OpenCodeClient`, `AgentApp`

## Problem

A harness run is a long, multi-step operation (clone, OpenCode session, prompt, verify, publish). Phase 1 keeps all of that state in memory and relies on `finally` for cleanup.

If the JVM, container or host dies:

- the ticket remains `in_progress` with an agent lock and no owner;
- the cloned workspace and temporary OpenCode config/home are left on disk;
- the OpenCode session and prompt context are lost;
- there is no record of which step completed;
- a retry can duplicate branches, commits or PRs;
- another agent may pick up the same ticket and race the original run.

`bp-53` added distributed state for the platform, but there is no harness-specific run/checkpoint/lease model.

## Goals

1. Persist every harness run and its current step before and after side effects.
2. Make recovery deterministic: resume from the last safe checkpoint or restart cleanly.
3. Guarantee at most one active run per ticket via leases.
4. Reap stale runs and orphaned workspaces automatically.
5. Make publishing idempotent: never create a second PR or overwrite unrelated work.
6. Expose run state for operators and the heartbeat.
7. Preserve the existing ticket status transitions on failure.

## Non-goals

- Distributed execution across multiple machines.
- Exactly-once model responses.
- Persisting the full OpenCode conversation beyond the run record (see fg-41).
- Changing the fg-30 ticket workflow.

## Functional requirements

- **FR1 - Run record:** persist run id, ticket id, agent id, branch, base SHA, workspace path, provider/model, started_at, updated_at, step and status.
- **FR2 - Checkpoints:** record a checkpoint after clone, session creation, prompt completion, verification, diff collection and publish.
- **FR3 - Lease:** claim a ticket with a TTL and heartbeat; a second agent cannot claim an unexpired lease.
- **FR4 - Recovery:** on agent startup, find runs owned by that agent; resume or fail them according to policy.
- **FR5 - Stale reaper:** expire leases, release tickets, mark runs failed, and delete workspaces older than the retention window.
- **FR6 - Idempotent publish:** detect an existing branch/PR for the ticket; push only the expected commit; never open a duplicate PR.
- **FR7 - Workspace registry:** track workspace paths, sizes and ages so cleanup is reliable.
- **FR8 - Dead letter:** after N failed attempts, stop retrying and require a human.
- **FR9 - Observability:** expose current run/step via heartbeat and structured events.
- **FR10 - Manual recovery:** an operator can mark a run failed, release the lease, or force a clean restart.

## Safety requirements

- A resumed run must never publish a diff from a different ticket or branch.
- Reaping must not delete a workspace whose lease is still valid.
- Force-clean restarts must not discard uncommitted work without an explicit operator action.
- Recovery must redact provider keys, GitHub tokens and server passwords.
- The stale reaper must be safe to run concurrently from multiple agents.

## Acceptance criteria

1. Killing the agent mid-prompt leaves a persisted run; a restart resumes or fails it cleanly and releases the ticket.
2. The same ticket cannot be processed by two agents concurrently.
3. Stale leases and orphaned workspaces are cleaned by a scheduled reaper.
4. A retry after a publish crash does not create a second PR.
5. Operators can see the run step and last checkpoint for any ticket.
6. All recovery paths have tests, including crash injection and lease races.
7. No secrets appear in run records, logs or recovery messages.

## Out of scope

- Cross-host run migration.
- Durable OpenCode event replay (fg-41).
- Multi-agent worktrees (fg-40).
- Sandboxing (fg-34).

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Structured harness event stream and replay | Observability | `fg-41-harness-observability` | No |
| 2 | fg-34 | Run workspaces inside an isolated sandbox | Security | `fg-34-harness-sandbox` | No |
| 3 | fg-40 | Parallel worktrees and multi-agent leases | Agent | `fg-40-multi-agent-orchestration` | No |
| 4 | bp-106 | Ship run/lease events to log aggregation | Observability | `bp-106-log-aggregation` follow-up | No |
