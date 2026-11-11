# 01_ARCHITECT_REQUIREMENT.md - Spec Review, Effort/Risk Scoring, and Policy-Gated Auto-Merge (fg-52)

**Related code:** `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`, `backend/src/services/TicketService.js`, `backend/src/services/HarnessRunService.js`, `backend/src/services/GitHubService.js`, `backend/src/services/PermissionService.js`, `backend/src/api/tickets.js`, `backend/src/api/harnessRuns.js`, `frontend/src/views/TicketDetail.vue`, `frontend/src/views/ProjectDetail.vue`

## Problem

The current harness opens a PR and waits for a human. That is correct for risky work but does not scale for genuinely small, well-understood changes. There is no spec-review step, no effort/risk assessment, no policy engine and no merge agent.

A naïve rule such as “effort < 30/100 means auto-merge” is unsafe:

- effort measures work, not blast radius;
- the implementing agent can influence or game its own estimate;
- a low-effort auth, billing, migration or workflow change can be high-risk;
- a vague spec can hide missing tests and security impact;
- model confidence is often poorly calibrated.

The system needs a tiered, auditable autonomy policy that starts in shadow mode and treats risk, confidence and deterministic gates as peers of effort.

## Goals

1. Make every ticket carry a structured spec suitable for review.
2. Add an independent spec-review pass with blocking/non-blocking findings.
3. Produce a structured effort/risk/confidence assessment from the final spec.
4. Bind the assessment to a spec revision; invalidate it when the spec changes.
5. Let projects opt into tiers: human-only, auto-approve, shadow auto-merge, low-risk auto-merge.
6. Enforce deterministic gates before any auto-approval or merge.
7. Keep the implementer, estimator, reviewer and merger separate.
8. Re-score the actual diff before merge to catch spec drift.
9. Audit every assessment, policy change, veto and merge.
10. Start in shadow/canary mode and provide a kill switch.

## Non-goals

- Auto-merging security-sensitive changes.
- Replacing human product prioritisation.
- Learned/ML calibration in the first implementation (record the data first).
- Auto-merge for failed, missing or waived traceability evidence.
- Letting the implementing agent approve its own work.
- Runtime tool/command permissions (file edit, shell, network, sandbox, permission requests): these remain the `fg-30` harness permission policy and `fg-34` sandbox rules. `fg-52` only consumes merge-time signals.
- A single opaque score that cannot be explained.

## Functional requirements

- **FR1 - Structured spec:** each ticket has a spec (planning file or equivalent) covering problem, scope, non-goals, acceptance criteria, affected areas, test plan, data/security impact and rollback notes. Simple tickets may use a reduced template, but the fields are explicit.
- **FR2 - Independent spec review:** a separate reviewer session/model reviews the spec read-only, returns structured findings with severity (`blocking`/`non-blocking`) and cites spec sections or repository evidence. The reviewer cannot edit the spec or implement the ticket.
- **FR3 - Bounded revision and re-estimation:** blocking findings go back to the author for a bounded number of rounds. The final spec revision is hashed; any later spec change invalidates the assessment and requires re-review/re-score.
- **FR4 - Structured assessment:** the estimator records effort `0–100`, risk/blast radius `0–100`, confidence `0–1`, band, signals, missing-information flags, rationale, estimator identity/model and the spec revision.
- **FR5 - Estimation rubric and provenance:** the estimate uses a documented rubric (scope, files/services, migrations, auth/billing/security, external deps, test burden, uncertainty). The implementing agent’s self-estimate is not authoritative. The estimator does not see the author’s scores before scoring.
- **FR6 - Policy tiers:** each project selects one tier: `off` (human-only), `auto_approve`, `shadow`, or `auto_merge_low_risk`. The default is `off`. `auto_approve` skips only the `human_approval` gate; a human still performs the merge, and review plus every deterministic gate still apply.
- **FR7 - Per-project configuration:** thresholds for effort/risk/confidence, additional deny paths, additional required gates, quotas and the project kill switch are project-scoped, validated, authorized and audited. Additional deny paths and gates are additive to a fixed platform baseline and cannot remove or weaken a baseline entry or mandatory gate. The platform-global control is a separate `super_admin` action.
- **FR8 - Deterministic gate engine:** before auto-approval or merge, evaluate CI/required checks, review verdict, tests changed, diff size/file/line limits, protected/high-risk paths, migrations/auth/billing/secrets/infra, dependency readiness, branch freshness, secret/publish guards and traceability evidence.
- **FR9 - Separate merge actor:** an independent merge agent (different session; different model/provider where available) performs the merge only in an enabled tier. It cannot edit code, bypass checks or approve its own work.
- **FR10 - Final-diff re-score:** before merge, re-evaluate the actual diff against the spec and risk gates. A mismatch, unexpected path, missing test or increased risk downgrades to human review.
- **FR11 - Audit, metrics and calibration:** store assessments, decisions, overrides, vetoes, merges and rollbacks with actor/model/provenance. Record every policy change with before/after values and scope (`project` or `global`) in an append-only audit row or the `fg-41` audit stream. Estimated effort is stored here; actual effort/outcomes come from `fg-37` evaluation and `fg-41` audit/usage data. Track estimated vs actual effort, review rounds, rollbacks and incidents; use the data to recalibrate thresholds.
- **FR12 - UI and API controls:** show the spec review, assessment and policy decision on the ticket; provide project settings for the tier/thresholds/deny paths/required gates and a human veto/force-review action.
- **FR13 - Shadow and canary rollout:** `shadow` records would-merge decisions without merging. A canary project can enable low-risk auto-merge. A project kill switch and a platform-global kill switch stop decisions immediately; a project cannot override the global switch.
- **FR14 - Readiness integration:** auto-approval requires dependency readiness (`bp-134`), Definition of Ready/risk sections (`fg-45`) and requirement traceability (`fg-51`). Missing evidence blocks the tier.
- **FR15 - Low-risk enablement gate:** `auto_merge_low_risk` stays disabled until the `fg-36` merge-queue and automatic-revert baselines are resolved (D6/D7), a documented calibration window passes, and a security review completes.

## Non-functional requirements

- **NFR1 - Untrusted content:** ticket text, specs, repository files and review output are untrusted data. The reviewer/estimator treats them as data, not instructions, and resists prompt injection.
- **NFR2 - Security-sensitive exclusion:** auth/permissions, billing, migrations, secrets, deployment/infra, protected paths and dependency changes are never auto-merged, regardless of effort score. These categories are detected by a fixed, non-configurable platform baseline; project configuration may add paths but cannot remove baseline coverage.
- **NFR3 - Separation of duties:** author, spec reviewer, estimator, implementer and merger are distinct roles/contexts. No self-approval or self-merge.
- **NFR4 - Fail closed/default off:** missing assessment, low confidence, policy ambiguity, audit failure or a disabled gate results in human review, never an automatic merge.
- **NFR5 - Audit and least privilege:** only authorized humans can change project policy or issue a waiver; only `super_admin` can change the platform-global control. Every change and decision is auditable and access-controlled.
- **NFR6 - Cost and latency bounds:** the extra spec-review and estimation passes have a documented cost/latency budget; simple tickets may use a cheaper reviewer, but deterministic gates are never skipped.
- **NFR7 - Calibration and model diversity:** confidence is not trusted in isolation; reviewer/estimator diversity and historical calibration are required before broad auto-merge.
- **NFR8 - Rollback and alerting:** an auto-merged change has a revert/rollback path, post-merge health detection and an operator alert on failure.

## Acceptance criteria

1. A ticket has an independently reviewed spec and a structured assessment before any autonomy decision.
2. `off` is the default and a project cannot auto-merge without an authorized, audited policy change.
3. A favourable estimate cannot bypass a failing CI check, protected path or missing dependency/traceability evidence.
4. A security-sensitive path is always routed to human review.
5. The implementer cannot estimate, approve or merge its own ticket.
6. A spec change invalidates the assessment; a final-diff mismatch downgrades auto-merge.
7. Shadow mode records decisions without merging; canary mode can be stopped by a project or global kill switch. `auto_merge_low_risk` is not enabled until the `fg-36` queue/revert baselines, calibration and security review pass.
8. Every assessment, veto, policy change and merge is auditable.
9. A human can always force review or veto an automatic decision.
10. The final PR/merge path records verification evidence at the reviewed SHA.
11. An empty project `additional_deny_paths` list cannot authorize a security-sensitive path; the fixed baseline still routes it to a human.

## Assumptions

| ID | Assumption | Impact if wrong | Validation/evidence |
|---|---|---|---|
| A1 | Effort and risk are separate axes | A single threshold would authorize unsafe low-effort changes | Design rationale; security-sensitive exclusion |
| A2 | A separate reviewer/estimator is affordable for the target ticket volume | The policy becomes the new bottleneck | Cost/latency budget; shadow metrics |
| A3 | Ticket planning files are the canonical spec source in this phase | A second spec store could diverge | `fg-45` planning/readiness design; first-class store deferred to `D8` |
| A4 | `bp-134`/`fg-31`/`fg-32`/`fg-36`/`fg-37`/`fg-41`/`fg-45`/`fg-51` land before this suite | The policy engine has no review/merge/trace/audit evidence to consume | `depends_on` frontmatter; roadmap order places fg-52 after fg-37/fg-41 |
| A5 | Project policy can be stored in a dedicated audited table | JSONB settings may be simpler but harder to audit | Design choice; migration review |
| A6 | Shadow mode produces enough signal before canary | Enabling auto-merge would rely on untested assumptions | Shadow metrics and calibration |
| A7 | Different model/provider improves independence | Same-model review may share blind spots | `fg-47` model-diversity policy |

## Change impact

| Area | Impact | Evidence/owner |
|---|---|---|
| API routes/contracts | Assessment/review/policy endpoints; ticket responses gain assessment/decision fields; OpenAPI and generated frontend types are updated | `api/tickets.js`, `api/harnessRuns.js`, `api/openapi-spec.js`, `frontend/src/api/generated/**` |
| Database/migrations | New assessment, review, policy, policy-change audit and decision tables | New migration(s); serialized with other tickets |
| Frontend | Ticket assessment panel, project autonomy settings on `ProjectDetail.vue`, veto/force-review action | `TicketDetail.vue`, `ProjectDetail.vue` |
| Agent/harness | Spec-review and estimation stages; merge-agent role; final-diff re-score | `HarnessTicketProcessor`, merge agent |
| Permissions/auth | Project policy changes require an operator/admin permission and project scope; global control is `super_admin`-only | `PermissionService` |
| Background jobs/external calls | Optional calibration/rollback monitors; GitHub merge API | fg-36, fg-41 |
| Downstream tickets | Consumes `bp-134`, `fg-31`, `fg-32`, `fg-36`, `fg-37`, `fg-41`, `fg-45`, `fg-51` | `depends_on` |
| Rollback | Disable the tier/kill switch; revert the merged commit; preserve audit | policy + fg-36 rollback |

## Out of scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
