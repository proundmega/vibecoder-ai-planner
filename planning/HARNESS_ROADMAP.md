# Harness Roadmap

**Last updated:** 2026-11-02
**Status:** planning index - no production code

This index groups the autonomous coding harness work. It links the execution plans, the review loop, and the cross-cutting hardening tickets.

## Suites

| ID | Directory | Status | Focus | Depends on |
|---|---|---|---|---|
| fg-30 | `fg-30-autonomous-coding-harness` | Phase 1 merged (#102); Phases 2-4 planned | OpenCode build harness, human loop, autonomy, hardening | bp-120/bp-121 |
| fg-31 | `fg-31-automatic-review-harness` | Merged (#103) | Read-only reviewer harness, structured findings, GitHub reviews | fg-30 Phase 1 |
| fg-32 | `fg-32-review-feedback-loop` | Merged (#104) | Reviewer -> fixer loop, same branch, rounds, escalation | fg-31 |
| fg-33 | `fg-33-durable-harness-execution` | In progress (slice 1: runs/checkpoints/leases) | Run/checkpoint/lease model, crash recovery, idempotent publish | fg-30 Phase 1 |
| fg-34 | `fg-34-harness-sandbox` | Planned | Sandbox isolation, limits, egress, secretless execution | fg-30 Phase 1 |
| fg-43 | `fg-43-agent-docker-deployment` | Planned | One-command Docker agent host sizing, role pools, per-container limits | fg-33 (fg-34 recommended) |
| fg-44 | `fg-44-agent-storage-lifecycle` | Planned | Per-agent workspaces, cleanup, idle refresh, disk/inode watermarks | fg-43, fg-33 |
| fg-45 | `fg-45-ticket-quality-gates` | Planned | Definition of Ready, acceptance criteria, readiness gates on every execution path | fg-30, fg-31/32 |
| fg-46 | `fg-46-flow-observability` | Planned - deferred | Flow stages, queue age, harness/provider/review metrics, `run_id` correlation | fg-30, fg-31/32, fg-33, fg-36, fg-41, fg-44, fg-45 |
| fg-35 | `fg-35-github-app-credentials` | Planned | GitHub App installation tokens, least privilege | fg-30 Phase 1 |
| fg-36 | `fg-36-merge-lifecycle` | Planned | Base branch, conflicts, CI gate, merge queue, rollback | fg-31, fg-32 |
| fg-37 | `fg-37-agent-evaluation-harness` | Planned | Golden corpus, grading, metrics, A/B, reviewer calibration | fg-30/31/32 |
| fg-38 | `fg-38-harness-budgets-routing` | Planned | Live budgets, hard stops, quotas, model routing/fallback | fg-30 Phase 1 |
| fg-39 | `fg-39-repo-environment-profiles` | Planned | Repo onboarding, images, caches, services, verification | fg-34 |
| fg-40 | `fg-40-multi-agent-orchestration` | Planned | Roles, task graph, worktrees, handoffs, integrator | fg-33, fg-36, fg-38, fg-39 |
| fg-41 | `fg-41-harness-observability` | Planned | Event stream, traces, replay, dashboards, audit | fg-33 |
| fg-42 | `fg-42-harness-privacy` | Planned | Classification, redaction, provider policy, retention | fg-34, fg-41 |

fg-30 Phases 2-4 (human loop, autonomy, hardening) remain part of the fg-30 implementation plan; the cross-cutting tickets above fill the gaps that were not specified there.

## Recommended order

### Phase A - Reliability and security foundations
1. **fg-33** durable execution and recovery
2. **fg-34** sandbox and supply-chain security
3. **fg-43** Docker agent host sizing and deployment
4. **fg-44** agent storage lifecycle and idle refresh
5. **fg-35** GitHub App credentials

### Phase B - Review loop
6. **fg-31** reviewer harness (merged in #103)
7. **fg-32** review feedback loop (merged in #104)
8. **fg-36** merge lifecycle and conflict handling

### Phase C - Quality and operations
9. **fg-45** ticket quality gates and Definition of Ready
10. **fg-37** evaluation harness
11. **fg-38** budgets and routing
12. **fg-39** repo environment profiles
13. **fg-41** observability, replay and audit
14. **fg-42** privacy and redaction (after fg-41, because event/artifact retention depends on it)
15. **fg-46** flow observability (deferred until a full build -> review -> fix -> merge cycle completes)

### Phase D - Scale
16. **fg-40** multi-agent orchestration
17. fg-30 Phase 3 autonomy policies / plan gate / auto-merge (write 03/04 when scheduled)

## How to use these suites

Each directory follows the planning template:

- `00_ARCHITECT_CHECKLIST.md` - decisions and delivery checklist
- `01_ARCHITECT_REQUIREMENT.md` - problem, goals, requirements, acceptance criteria
- `02_ARCHITECT_DESIGN.md` - architecture, data model, flow, rollout

`03_ARCHITECT_IMPLEMENTATION.md` and `04_SPECIFICATION.md` are written when a ticket is scheduled for implementation.

These are **roadmap-level** suites. `00` records decisions and the testing checklist, `01` includes Impact Analysis, Known Unknowns and Important Design Decisions, and `02` covers architecture, data model, flow and rollout. `03`/`04` add the implementation steps, the full test plan and the file-level specification when the ticket is scheduled. Older suites written before this convention may still omit those sections.

Schema convention: new harness tables use UUID primary keys (`UUID PRIMARY KEY DEFAULT gen_random_uuid()`), but foreign keys to existing tables (`tickets.id`, `projects.id`, `users.id`, `agents.id`) are `BIGINT` with real `REFERENCES`. Existing BIGSERIAL tables stay as they are. Keep this in every new suite.
