# Harness Roadmap

**Last updated:** 2026-11-08
**Status:** planning index - no production code

This index groups the autonomous coding harness work. It links the execution plans, the review loop, and the cross-cutting hardening tickets.

**Status vocabulary:** `Planned` = docs complete, not started; `Plan merged (#N); implementation pending` = the planning PR merged; `Merged (#N)` = the implementation merged. A planning-only PR is never `Merged`.

## Suites

| ID | Directory | Status | Focus | Depends on |
|---|---|---|---|---|
| fg-30 | `fg-30-autonomous-coding-harness` | Phase 1 merged (#102); Phases 2-4 planned | OpenCode build harness, human loop, autonomy, hardening | bp-120/bp-121 |
| fg-31 | `fg-31-automatic-review-harness` | Plan merged (#103); implementation pending | Read-only reviewer harness, structured findings, GitHub reviews | fg-30 Phase 1 |
| fg-32 | `fg-32-review-feedback-loop` | Plan merged (#104); implementation pending | Reviewer -> fixer loop, same branch, rounds, escalation | fg-31 |
| fg-33 | `fg-33-durable-harness-execution` | Merged (#110) | Run/checkpoint/lease model, crash recovery, idempotent publish | fg-30 Phase 1 |
| bt-60 | `bt-60-durable-harness-e2e-tests` | Plan merged (#111); ready for implementation (staging credentials pending) | Full harness e2e: real backend HTTP + Postgres, agent contract, disposable staging run | fg-33 (merged) |
| fg-34 | `fg-34-harness-sandbox` | Slices 1-2 merged (#126, #127); slice 3a merged (#128); slice 3b merged (#129); slice 3c in review (#130) | Sandbox isolation, limits, egress, secretless execution | fg-30 Phase 1 |
| fg-43 | `fg-43-agent-docker-deployment` | Planned | One-command Docker agent host sizing, role pools, per-container limits | fg-33 (fg-34 recommended) |
| fg-44 | `fg-44-agent-storage-lifecycle` | Planned | Per-agent workspaces, cleanup, idle refresh, disk/inode watermarks | fg-43, fg-33 |
| fg-45 | `fg-45-ticket-quality-gates` | Planned | Definition of Ready, pre-implementation risk review (assumptions, failure modes, security, impact), acceptance criteria, readiness gates on every execution path | fg-30, fg-31/32 |
| fg-46 | `fg-46-flow-observability` | Planned - deferred | Flow stages, queue age, harness/provider/review metrics, `run_id` correlation | fg-30, fg-31/32, fg-33, fg-36, fg-41, fg-44, fg-45 |
| fg-47 | `fg-47-independent-review-pass` | Planned | Independent second reviewer: different model/provider/context, read-only, dedupe/triage, blocking policy | fg-31, fg-32, fg-37, fg-41 |
| fg-48 | `fg-48-planning-claim-checks` | Planned | Deterministic `check-claims` script: structured evidence, index labels, matrix coverage, deferred counts | fg-47, fg-31 |
| fg-49 | `fg-49-planning-placeholder-check` | Planned | Migrated started suites (`in_progress`/`in_review`/`done`) fail on unresolved `{{...}}`; report suite/file/line/token; planned/deferred/cancelled, fenced/inline examples, Results, `DONE/`, `archived/`, `lightweight/` and legacy suites exempt/reported | fg-48 |
| fg-50 | `fg-50-planning-template-hygiene` | Planned | Move completed suites to `DONE/`, `00`–`04` repo/product template drift test (risk sections + lightweight `00`), retired-wording checks for migrated active suites/root templates (legacy reported), index validation, execution-only `04` | fg-48, fg-49 |
| fg-51 | `fg-51-requirement-traceability` | Planned | Requirement → code → test → verification evidence, per-requirement gap report, gate before human approval/merge, scoped waivers; consumed by `fg-32` fix requests and the `fg-36` stale-SHA merge gate | fg-31, fg-32, fg-36, fg-45, fg-48 |
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
1. **fg-33** durable execution and recovery (validation: **bt-60**; fg-33 slices 1-3 merged, Phase A/B unblocked)
2. **fg-34** sandbox and supply-chain security
3. **fg-43** Docker agent host sizing and deployment
4. **fg-44** agent storage lifecycle and idle refresh
5. **fg-35** GitHub App credentials

### Phase B - Review loop
6. **fg-31** reviewer harness (plan merged in #103; implementation pending)
7. **fg-32** review feedback loop (plan merged in #104; implementation pending)
8. **fg-36** merge lifecycle and conflict handling

### Review-quality follow-ups (after fg-31/fg-32)
- **fg-47** independent second reviewer (different model family/provider; advisory first)
- **fg-48** deterministic `check-claims` script for structured evidence and index labels
- **fg-49** planning placeholder check (migrated started suites fail on unresolved `{{...}}`; planned/deferred/cancelled, fenced/inline examples, Results, `DONE/`, `archived/`, `lightweight/` and legacy suites exempt/reported)
- **fg-50** planning template hygiene (move completed suites to `DONE/`, `00`–`04` template drift test, retired-wording checks for migrated active suites/root templates, index validation, execution-only `04`)
- **fg-51** requirement traceability (every `FR*`/`NFR*` maps to code, a test and passing verification at the reviewed SHA; gap report gates human approval/merge; scoped waivers; consumed by `fg-32`/`fg-36`)

### Phase C - Quality and operations
9. **fg-45** ticket quality gates and Definition of Ready (includes the pre-implementation risk review)
10. **fg-51** requirement traceability (after fg-32, fg-36 and fg-45; start in `warn`, enforce after the pilot)
11. **fg-37** evaluation harness
12. **fg-38** budgets and routing
13. **fg-39** repo environment profiles
14. **fg-41** observability, replay and audit
15. **fg-42** privacy and redaction (after fg-41, because event/artifact retention depends on it)
16. **fg-46** flow observability (deferred until a full build -> review -> fix -> merge cycle completes)

### Phase D - Scale
17. **fg-40** multi-agent orchestration
18. fg-30 Phase 3 autonomy policies / plan gate / auto-merge (write 03/04 when scheduled)

## How to use these suites

Run `node planning/check-planning.js` before opening a planning PR, and follow
`planning/README.md` §Review policy (independent reviewer, evidence-backed
findings, blocking-only fix rounds). `03` is the canonical verification matrix
and review record; `05` is the operational runbook.

Each directory follows the planning template:

- `00_ARCHITECT_CHECKLIST.md` - decisions and delivery checklist
- `01_ARCHITECT_REQUIREMENT.md` - problem, goals, requirements, acceptance criteria
- `02_ARCHITECT_DESIGN.md` - architecture, data model, flow, rollout

`03_ARCHITECT_IMPLEMENTATION.md` and `04_SPECIFICATION.md` are written when a ticket is scheduled for implementation.

These are **roadmap-level** suites. `00` records decisions and the testing checklist, `01` includes Impact Analysis, Known Unknowns and Important Design Decisions, and `02` covers architecture, data model, flow and rollout. `03`/`04` add the implementation steps, the full test plan and the file-level specification when the ticket is scheduled. Older suites written before this convention may still omit those sections.

Schema convention: new harness tables use UUID primary keys (`UUID PRIMARY KEY DEFAULT gen_random_uuid()`), but foreign keys to existing tables (`tickets.id`, `projects.id`, `users.id`, `agents.id`) are `BIGINT` with real `REFERENCES`. Existing BIGSERIAL tables stay as they are. Keep this in every new suite.
