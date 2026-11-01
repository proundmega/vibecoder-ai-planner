# 01_ARCHITECT_REQUIREMENT.md - Multi-Agent Orchestration (fg-40)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31, fg-32, fg-33, fg-36
**Related code:** `AgentApp`, `TicketWorker`, `HarnessTicketProcessor`, `PhaseService`

## Problem

The current model is one agent per ticket and one worker process. That works for small tickets but not for:

- large tickets that need planning + implementation + review;
- independent tasks that could run in parallel;
- multiple repos/services in one feature;
- specialization (architect vs builder vs reviewer);
- avoiding two agents editing the same files.

fg-30 Phase 3 mentions multi-agent at a high level, but there is no role model, task graph, worktree isolation, handoff contract, scheduler or conflict policy.

## Goals

1. Define explicit agent roles and permissions.
2. Decompose a ticket into a task graph with dependencies.
3. Run independent tasks in parallel with isolated worktrees/branches.
4. Hand off context and artifacts between roles.
5. Avoid file/branch conflicts and serialize merges.
6. Enforce per-agent budgets and quotas.
7. Preserve human approval gates and escalation.
8. Isolate failures so one agent cannot corrupt another's work.

## Non-goals

- Fully autonomous organization-wide planning.
- Replacing the human product owner.
- Arbitrary agent swarms without a task graph.
- Multi-repo atomic transactions.
- Auto-merge without policy.

## Functional requirements

- **FR1 - Roles:** architect (read-only plan), builder (write), reviewer (read-only), fixer (write, scoped to findings), integrator (merge/conflict).
- **FR2 - Task graph:** nodes with inputs, outputs, dependencies, owner role, budget and acceptance checks.
- **FR3 - Worktrees:** one branch/worktree per task; no shared writable workspace between parallel builders.
- **FR4 - Handoff:** a versioned artifact (plan, diff, findings, test report) passed to the next role.
- **FR5 - Scheduler:** topological order, parallelism limit, priority, fairness and retries.
- **FR6 - Conflict avoidance:** file claims or path ownership; detect overlaps before starting; serialize conflicting tasks.
- **FR7 - Verification:** each task verifies independently; the integrator verifies the combined result.
- **FR8 - Budgets:** per task/role/project; stop or re-plan on breach.
- **FR9 - Human gates:** plan approval, risky-change approval, final merge approval.
- **FR10 - Failure isolation:** a failed task does not corrupt completed tasks; retry/escalate per policy.

## Safety requirements

- Only builder/fixer roles can write; reviewer/architect are read-only.
- A task cannot modify files outside its declared scope without escalation.
- Parallel tasks cannot push to the same branch.
- The integrator cannot merge without approval and passing checks.
- Handoffs must be validated; a malformed handoff fails closed.
- Per-role credentials and permissions are enforced, not just prompted.

## Acceptance criteria

1. A ticket can be decomposed into a task graph and executed by role-specific agents.
2. Independent tasks run in parallel in isolated worktrees.
3. Overlapping file ownership is detected and serialized/escalated.
4. Handoffs are structured and validated.
5. The combined result is verified before review/merge.
6. Budgets are enforced per role/task.
7. A failed agent does not corrupt other work.
8. Tests cover parallel execution, conflicts, handoff validation, budget breach and failure isolation.

## Out of scope

- Cross-organization agent federation.
- Real-time agent-to-agent chat.
- Self-modifying agent roles.
- Automatic org-level roadmap planning.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-33 | Durable task/run state | Reliability | `fg-33-durable-harness-execution` | No |
| 2 | fg-36 | Merge queue for integrator | Delivery | `fg-36-merge-lifecycle` | No |
| 3 | fg-38 | Per-agent budgets | Billing | `fg-38-harness-budgets-routing` | No |
| 4 | fg-41 | Task-graph observability | Observability | `fg-41-harness-observability` | No |
