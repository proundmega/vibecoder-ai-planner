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
| fg-33 | `fg-33-durable-harness-execution` | Planned | Run/checkpoint/lease model, crash recovery, idempotent publish | fg-30 Phase 1 |
| fg-34 | `fg-34-harness-sandbox` | Planned | Sandbox isolation, limits, egress, secretless execution | fg-30 Phase 1 |
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
3. **fg-35** GitHub App credentials

### Phase B - Review loop
4. **fg-31** reviewer harness (merged in #103)
5. **fg-32** review feedback loop (merged in #104)
6. **fg-36** merge lifecycle and conflict handling

### Phase C - Quality and operations
7. **fg-37** evaluation harness
8. **fg-38** budgets and routing
9. **fg-39** repo environment profiles
10. **fg-41** observability, replay and audit
11. **fg-42** privacy and redaction (after fg-41, because event/artifact retention depends on it)

### Phase D - Scale
12. **fg-40** multi-agent orchestration
13. fg-30 Phase 3 autonomy policies / plan gate / auto-merge (write 03/04 when scheduled)

## How to use these suites

Each directory follows the planning template:

- `00_ARCHITECT_CHECKLIST.md` - decisions and delivery checklist
- `01_ARCHITECT_REQUIREMENT.md` - problem, goals, requirements, acceptance criteria
- `02_ARCHITECT_DESIGN.md` - architecture, data model, flow, rollout

`03_ARCHITECT_IMPLEMENTATION.md` and `04_SPECIFICATION.md` are written when a ticket is scheduled for implementation.

These are **roadmap-level** suites: `00`/`01`/`02` cover scope, requirements and design, but the `01` files intentionally omit Impact Analysis, Known Unknowns, Important Design Decisions and the full Testing Checklist. `03`/`04` add those sections and the test plan when the ticket is scheduled.

Schema convention: new harness tables use UUID primary keys, but foreign keys to existing tables (`tickets.id`, `projects.id`, `users.id`, `agents.id`) are `BIGINT` with real `REFERENCES`. Keep this in every new suite.
