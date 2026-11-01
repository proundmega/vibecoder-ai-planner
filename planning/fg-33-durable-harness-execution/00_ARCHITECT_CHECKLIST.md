# 00_ARCHITECT_CHECKLIST.md - Durable Harness Execution (fg-33)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor)
**Related code:** `HarnessTicketProcessor`, `WorkspaceManager`, `AgentApp`, `OpenCodeClient`

## Why this ticket exists

Phase 1 keeps the whole run in memory: clone, OpenCode session, prompt, verification and publish. If the agent process or container dies, the ticket can stay locked, the workspace is orphaned, the OpenCode session is lost, and there is no safe resume path. The `finally` cleanup only runs on a normal JVM exit.

## Checklist

- [ ] Define the persisted harness run/checkpoint model
- [ ] Define the lease/heartbeat model and stale-run reaper
- [ ] Decide resume policy per step (resume vs restart cleanly)
- [ ] Make publish idempotent (branch/PR detection, no duplicate PRs)
- [ ] Add workspace registry and orphan cleanup
- [ ] Add agent-startup recovery for runs owned by the agent
- [ ] Add crash/fault-injection tests (kill during prompt, verify, publish)
- [ ] Add operational metrics and alerts for stuck runs
- [ ] Document manual recovery and dead-letter handling
