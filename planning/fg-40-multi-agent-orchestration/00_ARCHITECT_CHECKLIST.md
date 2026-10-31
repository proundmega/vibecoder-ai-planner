# 00_ARCHITECT_CHECKLIST.md - Multi-Agent Orchestration (fg-40)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31, fg-32, fg-33, fg-36
**Related code:** `AgentApp`, `TicketWorker`, `HarnessTicketProcessor`, `PhaseService`

## Why this ticket exists

Today one process is a builder, a reviewer, or a fixer. There is no task decomposition, parallel work ownership, worktree isolation or handoff contract. fg-30 sketches a reviewer/fixer chain, but multi-agent coordination is undefined.

## Checklist

- [ ] Define roles and permissions (architect, builder, reviewer, fixer, integrator)
- [ ] Define the task graph and handoff schema
- [ ] Define worktree/branch ownership and locking
- [ ] Define the orchestrator and scheduling policy
- [ ] Define conflict avoidance and merge ordering
- [ ] Define per-agent budgets and quotas
- [ ] Define human gates and escalation
- [ ] Add failure isolation and partial-completion handling
- [ ] Test parallel tasks, conflicts, handoffs and agent failure
