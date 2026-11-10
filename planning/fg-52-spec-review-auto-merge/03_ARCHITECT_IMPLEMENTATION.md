# 03_ARCHITECT_IMPLEMENTATION.md - Spec Review, Effort/Risk Scoring, and Policy-Gated Auto-Merge (fg-52)

> **Owns:** work order, per-file changes, verification matrix, review record, results.
> **Not here:** requirements (`01`), design (`02`), status (`00`).

## Work order

1. Add the assessment/review/policy/decision tables and migration(s).
2. Add the structured spec schema and spec-revision hash.
3. Add the independent spec-review pass (read-only, structured findings, bounded rounds).
4. Add the estimator pass and rubric; bind the assessment to the spec revision.
5. Add the per-project policy model, validation, authorization and audit.
6. Add the deterministic gate engine and policy tiers (`off`, `auto_approve`, `shadow`, `auto_merge_low_risk`).
7. Add the independent merge agent and final-diff re-score.
8. Add ticket/project API and UI: assessment panel, policy settings, veto/force-review.
9. Add shadow/canary rollout controls and kill switch.
10. Add calibration metrics and rollback hooks.
11. Run unit, API, frontend and integration tests.

## Per-file changes

| File | Change |
|---|---|
| `backend/src/migrations/<next>_autonomy_policy.sql` | Review/assessment/policy/decision tables, rollback |
| `backend/src/services/SpecReviewService.js` | Spec review orchestration, findings, revision hash, bounded rounds |
| `backend/src/services/AssessmentService.js` | Effort/risk/confidence rubric, provenance, missing info |
| `backend/src/services/AutonomyPolicyService.js` | Per-project policy, validation, authorization, audit, kill switch |
| `backend/src/services/AutonomyGateService.js` | Deterministic gates and tier decision |
| `backend/src/services/AutoMergeService.js` | Final-diff re-score and merge-agent call |
| `backend/src/services/GitHubService.js` | Narrow merge API/permission path if not already present |
| `backend/src/api/tickets.js` | Assessment/review/decision read endpoints; veto/force-review |
| `backend/src/api/projects.js` | Autonomy policy settings endpoints |
| `backend/src/services/PermissionService.js` | Policy-change permission if a new one is needed |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | Spec-review/estimate stages or handoff to backend services |
| `agent/src/main/java/com/vibecode/agent/harness/AutoMergeClient.java` | Merge-agent client, reviewed SHA/evidence handoff |
| `frontend/src/views/TicketDetail.vue` | Spec review, assessment, decision, veto/force-review |
| `frontend/src/views/ProjectSettings.vue` | Tier/threshold/deny-path/kill-switch settings |
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
| FR7 | Unit/API | per-project policy validation, authorization, audit, kill switch | `npm test`; integration |
| FR8 | Unit/integration | each deterministic gate blocks independently; model cannot waive | `npm test`; integration |
| FR9 | Unit/integration | merge actor is separate, cannot edit/push/bypass, only merges on `allow` | merge-agent contract test |
| FR10 | Unit/integration | final-diff mismatch/unexpected path/missing test downgrades | integration test |
| FR11 | Unit/API | assessments/decisions/policy changes/vetoes/merges/rollbacks audited; calibration metrics | `npm test`; metrics test |
| FR12 | Frontend | assessment/policy/veto UI renders and propagates errors | `npm test -- --run`; `npm run typecheck` |
| FR13 | Unit/integration | shadow records would-merge without merge; canary + kill switch stops | integration test |
| FR14 | Unit/integration | missing readiness/dependency/traceability blocks autonomy | integration test |
| NFR1 | Unit/adversarial | prompt-injection spec/repo content does not execute or change policy | adversarial review test |
| NFR2 | Unit/integration | auth/billing/migrations/secrets/infra/protected/dependency changes always human | gate tests |
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

## Results

No implementation results yet. This suite is planned.
