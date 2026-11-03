# 00_ARCHITECT_CHECKLIST.md - Durable Harness Execution (fg-33)

**Status:** In progress — slices 1-3 (persistence/recovery/operator cleanup) implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor)
**Related code:** `HarnessTicketProcessor`, `WorkspaceManager`, `AgentApp`, `OpenCodeClient`, `HarnessRunService`, `api/harnessRuns.js`

## Why this ticket exists

Phase 1 keeps the whole run in memory: clone, OpenCode session, prompt, verification and publish. If the agent process or container dies, the ticket can stay locked, the workspace is orphaned, the OpenCode session is lost, and there is no safe resume path. The `finally` cleanup only runs on a normal JVM exit.

## Checklist

- [x] Define the persisted harness run/checkpoint model
- [x] Define the lease/heartbeat model and stale-run reaper
- [x] Decide resume policy per step (resume vs restart cleanly)
- [x] Make publish idempotent (branch/PR detection, no duplicate PRs)
- [x] Track workspace paths and clean stale workspaces at startup
- [ ] Add full workspace inventory (sizes, ages, scheduled cleanup, disk metrics — fg-44)
- [x] Add agent-startup recovery for runs owned by the agent
- [x] Skip recovery when the run's heartbeat/lease is still fresh
- [ ] Add crash/fault-injection tests (process-kill matrix — CI follow-up)
- [x] Add reaper/run metrics and stuck-run alert guidance
- [ ] Add workspace inventory/disk metrics (fg-44)
- [ ] Add automatic dead-letter after N failed attempts (manual dead-letter implemented; FR8 deferred)
- [x] Document manual recovery and dead-letter handling
- [ ] Add an explicit force-clean-restart operator action (FR10 follow-up)
