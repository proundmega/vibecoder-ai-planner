---
id: "fg-52"
title: "Spec Review, Effort/Risk Scoring, and Policy-Gated Auto-Merge"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-11-10"
updated: "2026-11-10"
pr: null
branch: null
depends_on: ["bp-134", "fg-31", "fg-32", "fg-36", "fg-37", "fg-41", "fg-45", "fg-51"]
---

# 00 — Spec Review, Effort/Risk Scoring, and Policy-Gated Auto-Merge (fg-52)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`, `backend/src/services/TicketService.js`, `backend/src/services/HarnessRunService.js`, `backend/src/services/GitHubService.js`, `backend/src/api/tickets.js`, `backend/src/services/PermissionService.js`, `frontend/src/views/TicketDetail.vue`, `frontend/src/views/ProjectDetail.vue`

## Why this ticket exists

The current flow treats every ticket as requiring the same human attention. That does not scale: agents can produce many small, well-understood changes while humans remain the bottleneck. At the same time, a single “effort < 30 means merge” rule would be unsafe because effort is not risk. A one-line auth or billing change can be low effort and high impact.

This ticket defines a **tiered autonomy policy**:

1. an agent-authored spec,
2. an independent spec review,
3. a structured effort/risk/confidence assessment,
4. deterministic readiness and merge gates,
5. per-project policy: human-only, auto-approve, shadow auto-merge, or low-risk auto-merge.

The implementer, estimator, reviewer and merger are separate roles. Effort is one input, never the sole authority.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Budget/cost-aware routing and hard stops | fg-38 | Cost | fg-38-harness-budgets-routing | open |
| D2 | Learned calibration model for estimates vs actuals | fg-37 | Evaluation | fg-52 follow-up | open |
| D3 | Multi-model ensemble estimation | self | Quality | fg-52 follow-up | open |
| D4 | Auto-merge for security-sensitive scopes (auth, billing, migrations, secrets, infra) | self | Security | not planned; must remain human-only | rejected |
| D5 | Cross-project policy inheritance | self | Administration | fg-52 follow-up | open |
| D6 | fg-52 consumption of the fg-36 merge-queue API (fg-36 owns the queue) | fg-36 | Merge | fg-36-merge-lifecycle | open — gated by FR15 |
| D7 | Automatic revert on post-merge failure (fg-36 owns revert; fg-52 consumes it) | fg-36 | Reliability | fg-36-merge-lifecycle | open — gated by FR15 |
| D8 | First-class `ticket_specs` store (this phase uses ticket planning files as the canonical spec) | self | Storage | fg-52 follow-up | open |

## Important design decisions

1. **Effort is not risk.** Store and evaluate effort and risk/blast-radius separately.
2. **Confidence is required.** A low-confidence estimate cannot authorize autonomy even if the scores are low.
3. **Default off.** A project has no autonomy until an authorized human enables a mode.
4. **Separate roles.** Spec author ≠ spec reviewer ≠ estimator ≠ implementer ≠ merger.
5. **Deterministic gates win.** CI, tests, protected paths, dependency readiness and traceability are hard requirements; model judgement cannot waive them.
6. **Tiers, not a single switch:** human-only, auto-approve, shadow auto-merge, low-risk auto-merge.
7. **Auto-approve and auto-merge are distinct.** Auto-approve can skip a human approval step; auto-merge changes the default branch and needs the strongest gates.
8. **Spec changes invalidate the assessment.** The assessment is bound to a spec revision/hash.
9. **Score the final diff too.** A spec can be low-risk while the implementation is not.
10. **Human override and veto always win.** A human can disable, veto or force review at any time.
11. **Security-sensitive paths are excluded** from auto-merge: auth/permissions, billing, migrations, secrets, deployment/infra, protected paths and dependency changes.
12. **Shadow first.** Record “would auto-merge” decisions without merging, then canary a project before broader rollout.

## Ownership and relationship to fg-30 Phase 3 / fg-36

- **Single owner.** `fg-52` is the sole owner of the autonomy policy engine, effort/risk/confidence assessment, auto-approve and auto-merge decisions. It supersedes and narrows the “policy engine / autonomy modes / auto-merge” part of `fg-30` Phase 3.
- **`fg-30` Phase 3** retains only residual plan-approval/multi-agent integration; `fg-45` owns readiness and `fg-40` owns orchestration. It consumes `fg-52` policy decisions and must not define a second autonomy mode or auto-merge path. Budgets remain owned by `fg-38`.
- **`fg-36`** owns merge mechanics (base branch, conflicts, CI gate, merge queue, rollback). It consumes an `fg-52` `allow` decision and does not define policy; its references have been updated to point at `fg-52`.
- **Runtime permissions are not fg-52.** Tool/command allow/ask/deny, protected-path action approval and sandbox rules remain the `fg-30` harness permission policy and `fg-34` sandbox rules. `fg-52` consumes only merge-time signals.
- **No duplicate implementation.** A later ticket that needs autonomy policy extends `fg-52` rather than adding a parallel engine.

**fg-36 dependency scope:** `fg-36`'s core merge lifecycle (base branch, CI gate, merge queue, rollback path) is a hard dependency. `off`, `auto_approve` and `shadow` may start once that baseline lands. `auto_merge_low_risk` stays disabled until D6 (fg-52 consumes the queue API) and D7 (fg-52 consumes automatic revert) are resolved.

## Known unknowns

- Initial thresholds for effort, risk and confidence (proposal: effort ≤ 30, risk ≤ 20, confidence ≥ 0.8; all configurable).
- The minimum calibration sample size before enabling low-risk auto-merge.
- Which model/provider diversity is required for the reviewer/merger.

Resolved: ticket planning files are the canonical spec source in this phase; a first-class `ticket_specs` store is deferred to `D8`.

Resolved: `auto_approve` skips only the human **approval** step (the `human_approval` gate); a human still performs the merge. It never skips review or a deterministic gate. The security-sensitive deny list is a fixed platform baseline that projects may extend but never replace.

## Testing checklist

- [ ] Spec author and reviewer are separate contexts; reviewer findings are structured.
- [ ] Assessment records effort, risk, confidence, signals, missing info, rationale and provenance.
- [ ] A spec change invalidates the assessment and blocks auto-approve until re-scored.
- [ ] Policy defaults to off and requires an authorized, audited change.
- [ ] Each tier (`off`, `shadow`, `auto_approve`, `auto_merge_low_risk`) behaves as designed; `auto_approve` skips approval but not review or human merge.
- [ ] Deterministic gates override a favourable estimate.
- [ ] Security-sensitive paths cannot be auto-merged in any tier, even when a project sets `additional_deny_paths = []`.
- [ ] The baseline regression classifies every real auth/permission path (`backend/src/auth.js`, `backend/src/api/routes.js`, `backend/src/middleware/auth.js`, `backend/src/api/permissions.js`, `backend/src/services/PermissionService.js`, `backend/src/validators/auth.js`) as human-only.
- [ ] Project deny paths are additive to the fixed platform baseline; a project cannot remove a baseline path.
- [ ] Required gates and quotas are enforced and covered by tests.
- [ ] Project and global kill switches stop decisions immediately; a project cannot override the global switch.
- [ ] Only `super_admin` can change the global control.
- [ ] Every policy change is recorded in an append-only audit trail; global changes and hard-deleted projects remain distinguishable.
- [ ] A global policy change uses `scope='global'`/null project and a deleted project keeps its `scope='project'` history.
- [ ] The database constraint rejects `scope='global'` with a project id and `scope='project'` with a null id or empty name.
- [ ] `auto_merge_low_risk` cannot be enabled until the fg-36 queue and automatic-revert baselines (D6/D7) are resolved.
- [ ] Implementer cannot estimate or merge its own ticket.
- [ ] Final-diff re-score can downgrade or reject an auto-merge.
- [ ] Human veto/override is immediate and audited.
- [ ] Shadow mode records would-merge decisions without calling GitHub merge.
- [ ] Rollback/revert path and alerting are tested.
- [ ] Audit history is immutable and queryable per project/ticket.
- [ ] Cost/latency bounds for the extra review/estimate passes are documented.
