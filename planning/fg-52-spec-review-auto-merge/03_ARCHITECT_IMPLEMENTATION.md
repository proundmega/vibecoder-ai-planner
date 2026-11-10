# 03_ARCHITECT_IMPLEMENTATION.md - Spec Review, Effort/Risk Scoring, and Policy-Gated Auto-Merge (fg-52)

> **Owns:** work order, per-file changes, verification matrix, review record, results.
> **Not here:** requirements (`01`), design (`02`), status (`00`).

## Work order

1. Add the assessment/review/policy/decision tables and migration(s).
2. Add the structured spec schema and spec-revision hash.
3. Add the independent spec-review pass (read-only, structured findings, bounded rounds).
4. Add the estimator pass and rubric; bind the assessment to the spec revision.
5. Add the per-project policy model, fixed security baseline, validation, authorization, required gates, quotas and append-only policy-change audit.
6. Add the deterministic gate engine and policy tiers (`off`, `auto_approve`, `shadow`, `auto_merge_low_risk`).
7. Add the independent merge agent and final-diff re-score.
8. Add ticket/project API and UI: assessment panel, policy settings, veto/force-review.
9. Add shadow/canary rollout controls plus the project and platform-global kill switches.
10. Add calibration metrics and rollback hooks.
11. Run unit, API, frontend and integration tests.

## Per-file changes

| File | Change |
|---|---|
| `backend/src/migrations/<next>_autonomy_policy.sql` | Review/assessment/policy/policy-change/global-control/decision tables, rollback |
| `backend/src/services/SpecReviewService.js` | Spec review orchestration, findings, revision hash, bounded rounds |
| `backend/src/services/AssessmentService.js` | Effort/risk/confidence rubric, provenance, missing info |
| `backend/src/services/AutonomyPolicyService.js` | Per-project policy, additive baseline, validation, authorization, required gates, quotas, append-only policy-change audit, project/global kill switch |
| `backend/src/services/AutonomyGateService.js` | Deterministic gates (fixed security baseline union project additions) and tier decision |
| `backend/src/services/AutoMergeService.js` | Final-diff re-score and merge-agent call |
| `backend/src/services/GitHubService.js` | Narrow merge API/permission path if not already present |
| `backend/src/api/tickets.js` | Assessment/review/decision read endpoints; veto/force-review |
| `backend/src/api/projects.js` | Autonomy policy settings endpoints |
| `backend/src/services/PermissionService.js` | Policy-change permission if a new one is needed |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | Spec-review/estimate stages or handoff to backend services |
| `agent/src/main/java/com/vibecode/agent/harness/AutoMergeClient.java` | Merge-agent client, reviewed SHA/evidence handoff |
| `frontend/src/views/TicketDetail.vue` | Spec review, assessment, decision, veto/force-review |
| `frontend/src/views/ProjectDetail.vue` | Tier/threshold/deny-path/required-gate/kill-switch settings section |
| `frontend/src/api/tickets.ts`, `frontend/src/api/projects.ts` | Types and error propagation |
| Tests | service unit, API, frontend, migration, integration, merge-agent contract |

## Verification matrix

| Requirement | Layer | Test / command | Evidence |
|---|---|---|---|
| FR1 | Unit/API | spec schema requires problem/scope/acceptance/affected areas/test/security/rollback; simple template path | `npm test` |
| FR2 | Unit/integration | separate reviewer context returns structured findings; cannot edit spec | `npm test`; agent integration |
| FR3 | Unit | blocking findings loop bounded; spec revision change invalidates review/assessment | `npm test` |
| FR4 | Unit/API | assessment stores effort/risk/confidence/signals/missing-info/rationale/provenance | `npm test` |
| FR5 | Unit/review | rubric anchors and separate estimator; author self-estimate ignored | `npm test`; review record |
| FR6 | Unit/API | all four tiers and default `off` behave correctly | `npm test`; API tests |
| FR7 | Unit/API | per-project policy validation, authorization, additive baseline, required gates, quotas, project kill switch and append-only policy-change audit | `npm test`; integration |
| FR8 | Unit/integration | each deterministic gate blocks independently; model cannot waive; baseline cannot be cleared by project config | `npm test`; integration |
| FR9 | Unit/integration | merge actor is separate, cannot edit/push/bypass, only merges on `allow` | merge-agent contract test |
| FR10 | Unit/integration | final-diff mismatch/unexpected path/missing test downgrades | integration test |
| FR11 | Unit/API | assessments/decisions/policy changes/vetoes/merges/rollbacks audited; policy changes record before/after; calibration metrics | `npm test`; audit test |
| FR12 | Frontend | assessment/policy/veto UI renders and propagates errors | `npm test -- --run`; `npm run typecheck` |
| FR13 | Unit/integration | shadow records would-merge without merge; canary stops on project or global kill switch; project cannot override global | integration test |
| FR14 | Unit/integration | missing readiness/dependency/traceability blocks autonomy | integration test |
| NFR1 | Unit/adversarial | prompt-injection spec/repo content does not execute or change policy | adversarial review test |
| NFR2 | Unit/integration | auth/billing/migrations/secrets/infra/protected/dependency changes always human, including with empty `additional_deny_paths`; baseline covers auth, billing, migrations, secrets, Jenkinsfile, docker-compose*, package manifests and pom files | gate tests |
| NFR3 | Review/unit | author/reviewer/estimator/implementer/merger separation enforced | role tests; review record |
| NFR4 | Unit/integration | missing assessment/low confidence/audit failure defaults to human | fail-closed tests |
| NFR5 | API/integration | policy/waiver permissions, audit and least-privilege access | API tests |
| NFR6 | Review/measurement | cost/latency budget documented and measured; cheap reviewer path | shadow metrics |
| NFR7 | Review/calibration | model diversity/calibration report before canary | calibration report |
| NFR8 | Integration | revert/rollback path and post-merge alert | fg-36 integration |

## Review record

| Round | Finding | Resolution | Status |
|---|---|---|---|
| 0 | Plan review pending | — | open |
| 1 | Dependency graph omitted `bp-134`; fg-37/fg-41 order inconsistent; policy ownership overlapped fg-30 Phase 3/fg-36; security baseline was configurable; FR7 gates/quotas and policy-change audit were missing; `ProjectSettings.vue` did not exist | Added bp-134 everywhere, ordered fg-52 after fg-37/fg-41, declared fg-52 the single autonomy owner, added a fixed additive baseline and global kill switch, added additional gates/quotas plus `autonomy_policy_changes`, and moved UI work to `ProjectDetail.vue` | resolved |

## Results

No implementation results yet. This suite is planned.
