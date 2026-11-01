# 02_ARCHITECT_DESIGN.md - Multi-Agent Orchestration (fg-40)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31, fg-32, fg-33, fg-36

## Design summary

Add an orchestrator that turns a ticket into a task graph, assigns roles, provisions isolated worktrees, runs tasks within dependency/parallelism limits, and hands artifacts between roles. The existing supervisor remains the execution unit; the orchestrator is the scheduler.

```
Ticket
  -> Architect: plan + file ownership
  -> Task graph (build A, build B, tests, docs)
       -> parallel builders in isolated worktrees
       -> reviewer
       -> fixer (if needed)
       -> integrator: combine + verify
  -> human approval / merge queue
```

## Roles and permissions

| Role | Read | Write | Git | Review | Merge |
|---|---|---|---|---|---|
| Architect | yes | no | no | no | no |
| Builder | yes | yes (scope) | supervisor publish | no | no |
| Reviewer | yes | no | no | yes | no |
| Fixer | yes | yes (findings scope) | supervisor publish | no | no |
| Integrator | yes | conflict-only | supervisor publish | no | via queue |

Permissions are enforced at the API/tool level, not only in prompts.

## Task graph

```json
{
  "ticket_id": "...",
  "plan_version": 1,
  "tasks": [
    {
      "id": "T1",
      "role": "builder",
      "title": "Backend API",
      "depends_on": [],
      "write_scope": ["backend/src/**"],
      "budget": { "minutes": 30, "usd": 2 },
      "acceptance": ["cd backend && npm test"]
    }
  ]
}
```

- Validate DAG (no cycles), scopes, roles and budgets.
- Reject overlapping write scopes unless tasks are serialized.
- Each task gets its own branch/worktree from the current integration branch.

## Worktrees and branches

- Integration branch per ticket; task branches `vibecode/ticket-<id>/<task>`.
- A task's supervisor clones/creates the task branch; parallel tasks never share a writable workspace.
- Completed tasks are merged/cherry-picked into the integration branch by the integrator, not by builders.
- File claims are recorded before work starts; conflicts are detected from the plan and from actual diffs.

## Handoff contract

```json
{
  "task_id": "T1",
  "role": "builder",
  "status": "done",
  "branch": "...",
  "head_sha": "...",
  "diff_summary": {...},
  "verification": [...],
  "decisions": ["..."],
  "residual_risks": ["..."],
  "open_questions": ["..."]
}
```

Handoffs are persisted, schema-validated and included in the next role's prompt.

## Orchestrator

- Topological scheduler with max parallelism per project/agent.
- Priority and fairness; retry with backoff; dead-letter.
- Budget allocation per task; re-plan when a task exceeds budget.
- Failure isolation: a failed task blocks dependents, not unrelated tasks.
- Human escalation for plan approval, risky files, repeated failure and merge.

## Conflict avoidance

1. Plan-level: file/path scopes; overlapping scopes serialize.
2. Runtime: check actual diffs before integration; detect overlap.
3. Integration: merge tasks in dependency order; re-run combined verification.
4. On conflict: integrator/fixer resolves; if semantic, human.

## Data model

```sql
CREATE TABLE work_plans (
  id UUID PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  version INT NOT NULL,
  graph JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE work_tasks (
  id UUID PRIMARY KEY,
  plan_id UUID REFERENCES work_plans(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  branch TEXT,
  write_scope JSONB,
  depends_on JSONB,
  status TEXT NOT NULL,
  handoff JSONB,
  budget JSONB
);
```

## Tests

- DAG validation (cycles, missing deps);
- parallel independent tasks;
- overlapping scopes serialize;
- handoff schema validation;
- failed task blocks dependents only;
- budget breach re-plans/stops;
- integration conflict escalation.

## Rollout

1. Architect + single builder + reviewer (sequential).
2. Add task graph with one task.
3. Enable parallel independent tasks in one project.
4. Add integrator and conflict policy.
5. Add per-role budgets and human gates.

## Open questions

1. Centralized orchestrator vs peer-to-peer agents?
2. How is the plan approved: human, architect, or both?
3. Should tasks share a base commit or branch from each other?
4. How do we handle cross-repo tasks?
5. What is the maximum parallel fan-out per project?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-33 | Durable task/run state | Reliability | `fg-33-durable-harness-execution` | No |
| 2 | fg-36 | Merge queue for integrator | Delivery | `fg-36-merge-lifecycle` | No |
| 3 | fg-38 | Per-agent budgets | Billing | `fg-38-harness-budgets-routing` | No |
| 4 | fg-41 | Task-graph observability | Observability | `fg-41-harness-observability` | No |
