# 01_ARCHITECT_REQUIREMENT.md - Durable Harness Execution (fg-33)

**Status:** Slices 1-3 implemented on the feature branch; FR5/FR7/FR8/FR9/FR10 are partial and explicitly deferred as noted below.
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

- **FR1 - Run record:** persist run id, ticket id, agent id, branch, base SHA, workspace path, provider/model, started_at, heartbeat_at, finished_at, step and status. `heartbeat_at`/`finished_at` are the liveness/terminal timestamps; there is no separate `updated_at`.
- **FR2 - Checkpoints:** record a checkpoint after clone, session creation, prompt completion, verification and publish; diff collection is folded into the `publishing`/`done` checkpoints.
- **FR3 - Lease:** claim a ticket with a TTL and heartbeat; a second agent cannot claim an unexpired lease.
- **FR4 - Recovery:** on agent startup, find runs owned by that agent; resume or fail them according to policy.
- **FR5 - Stale reaper:** expire leases, release tickets and mark runs failed in the scheduled backend reaper. Workspace cleanup runs at agent startup; scheduled workspace cleanup is deferred to fg-44.
- **FR6 - Idempotent publish:** detect an existing branch/PR for the ticket; push only the expected commit; never open a duplicate PR.
- **FR7 - Workspace registry:** track `workspace_path` and age-based startup cleanup. Full size/age inventory and disk-usage/leftover metrics are deferred to fg-44.
- **FR8 - Dead letter (manual for now):** operators can dead-letter a failed run. Automatic dead-letter after N failed attempts is deferred; `HARNESS_MAX_ATTEMPTS` currently controls retry backoff only.
- **FR9 - Observability:** expose current run/step via heartbeat, checkpoints and Prometheus counters. Structured event streaming is deferred to fg-41.
- **FR10 - Manual recovery:** an operator can dead-letter a run or adopt published work. An explicit force-clean-restart action is deferred; the runbook documents manual reset.

## Safety requirements

- A resumed run must never publish a diff from a different ticket or branch.
- Reaping must not delete a workspace whose lease is still valid.
- Clean restart is the policy for interrupted non-published runs. The old workspace is retained for `HARNESS_WORKSPACE_RETENTION_HOURS` for debugging; there is no automatic discard before failure handling and no operator hold action yet.
- Recovery must redact provider keys, GitHub tokens and server passwords.
- The stale reaper must be safe to run concurrently from multiple agents.

## Acceptance criteria

1. Killing the agent mid-prompt leaves a persisted run; a restart resumes or fails it cleanly and releases the ticket.
2. The same ticket cannot be processed by two agents concurrently.
3. Stale leases and ticket state are cleaned by the scheduled backend reaper; stale workspaces are cleaned at agent startup (scheduled workspace cleanup deferred to fg-44).
4. A retry after a publish crash does not create a second PR.
5. Operators can see the run step and last checkpoint for any ticket.
6. All recovery paths have service/processor tests, including simulated crash gaps and lease races. A CI process-kill matrix is deferred.
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
