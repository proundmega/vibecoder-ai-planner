---
id: "fg-54"
title: "Agent Fleet: Nodes, Model Registry and Enforced Roles"
status: done
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-11-19"
updated: "2026-11-21"
pr: 179
branch: feat/fg-54b-runtime-ui
depends_on: ["fg-53"]
---

# 00 — Agent Fleet: Nodes, Model Registry and Enforced Roles (fg-54)

> **Owns:** status, status evidence, ticket map, readiness/completion gates,
> deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), exact file operations (`04`).

## Why this ticket exists

Running a small fleet exposes four separate limits in the current agent model.

1. An agent is a **child of a project** (`agents.project_id`), so a host that
   serves several projects needs one enrollment and one container per
   `(project, role, model)`.
2. A provider row fuses **key + model + roles** (`providers.api_key_encrypted`,
   `providers.model`, `providers.roles`), so changing the model or reusing one
   key for two models means duplicating credentials or re-pointing agents.
3. The build/review/plan distinction is asserted by the client (`AGENT_MODE`)
   and never checked by the backend, so a node can act outside its intended
   role.
4. There is no host-level deployment unit: every node is a hand-minted token and
   a separate Compose project, and deleting a credential that is still in use
   has no guard.

This ticket replaces that with a node/grant/runtime/lease model: enroll a host
once, grant it `(project, role)` capabilities, tag models with roles, and run a
static supervisor that reconciles a declared set of runtimes in one Compose
stack. The manager becomes a server-side service with replicas instead of a
long-running agent role.

## Ticket map

| Doc | Present | Note |
|---|---|---|
| `01_ARCHITECT_REQUIREMENT.md` | ☑ | |
| `02_ARCHITECT_DESIGN.md` | ☑ | |
| `03_ARCHITECT_IMPLEMENTATION.md` | ☑ | |
| `04_SPECIFICATION.md` | ☐ | optional; add per slice when implementation starts |
| `05_RUNBOOK.md` | ☐ | optional; operator steps are summarised in `02` → Rollout |

## Readiness gate (before implementation)

- [x] `01` has numbered `FR*`/`NFR*`, each with a testable acceptance statement
- [x] `01` has assumptions and change impact; `02` has failure modes and
      security considerations
- [x] `02` records the current-state audit and the chosen design
- [x] `03` has a verification-matrix row for every `FR*`/`NFR*`
- [x] Tests are named with their requirement ID
- [x] Deferred register below is complete; out-of-scope items are recorded here
- [x] Open decisions are answered or explicitly accepted as assumptions
- [x] No fact is duplicated across documents (see `planning/README.md`)
- [x] Review policy is applied: independent reviewer, evidence-backed findings,
      blocking-only fix rounds (`planning/README.md` §Review policy)
- [x] Status evidence below matches the intended status

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | PR #177 (merged) | ☑ |
| Control plane merged | PR #178 merged; registry #180, visibility #181, claim/release #182, runtime-owned harness runs/leases/usage #183 and denial/registry routing #184 merged | ☑ |
| Runtime/UI implementation | PR #179 merged as `bfd1d8a` | ☑ |
| Clean cut is the default | PR #191: 057 registered after 059, legacy agent/provider/auth routes, services, tables and `agent_id` columns removed, migration ledger added; PR #190 (`9126e26`) regenerated the frontend API client from the post-cut spec | ☑ |
| Implementation merged | PR #179 (`bfd1d8a`), Track A follow-up #184 (`809789f`), generated-client follow-up #190 (`9126e26`) and clean cut #191 (`2a34db5`) merged | ☑ |
| Verification results | `03` → Results; backend 148 suites / 1750 tests, integration 18 suites / 138 tests, agent 900 tests (10 skipped), frontend 66 files / 575 tests | ☑ |

A merged planning PR is **plan merged**, not `done`. Set `status: done` only
after the implementation PR is merged and `03` has a dated Results row.

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Manager-pushed desired state (dynamic fleet dispatch) instead of a static supervisor config | self | Operations | fg-54 phase 2 | open |
| D2 | Per-runtime credentials instead of node-trust plus an `X-Agent-Runtime` header | self | Security | new ticket | open |
| D3 | mTLS or SPIFFE/SPIRE node identity instead of bearer node tokens | self | Security | none | open |
| D4 | Model pricing/capability catalog feeding fg-38 routing and budgets | fg-38 | Cost / Routing | fg-38 | open |
| D5 | Cross-host scheduling and horizontal autoscaling of runtimes | self, fg-40 | Infrastructure | fg-40 | open |
| D6 | GPU and hardware profiles per node | fg-43 | Infrastructure | fg-43 | open |
| D7 | Discovery adapters beyond OpenAI-compatible, Anthropic and Ollama (vLLM/LM Studio variants) | self | Integration | none | open |
| D8 | Migration of legacy `ak_…` keys and project-bound agents | self | Migration | none — dropped by the approved clean cut | dropped |
| D9 | `PoolManager` container-per-agent mode; replaced by supervisor runtimes on enrolled nodes | self | Infrastructure | none — PoolManager removed by #191 | dropped |
| D10 | Reviewer authority beyond comment-only: bounded approval/close for **small tickets** (risk threshold, evidence, audit); explicitly not in this suite | self | Product | new ticket | open |
| D11 | Bulk fleet operations (import/export, clone a node config) in the UI | self | UX | none | open |
| D12 | Credential version-history UI and rollback to a previous secret version | self | Security / UX | none | open |
| D13 | Fleet dashboards and alerts (node down, runtime crash-loop, model verification failures) | fg-41 | Observability | fg-41 | open |
| D14 | Organization/tenant-scoped credentials and grants above the project level | self | Authorization | none | open |
| D15 | Planner runtimes with their own planning-template authoring loop (fg-40 handoffs) | fg-40 | Product | fg-40 | open |
| D16 | Let an in-flight run finish, publish and log usage while its runtime is `draining`; #183 currently requires `running` on those routes | #183 review | Operations | Track A follow-up | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Compatibility with pre-existing agent keys and project-bound agents | Migrate / clean cut | clean cut | **Clean cut approved (2026-11-19).** No production deployments; no backfill, no legacy `ak_…` migration. Document it. |
| 2 | Is `planner` a real runtime role? | Add / fold into worker | add | **Yes — planner is a real role with running instances** producing planning templates. |
| 3 | Where does the manager live? | Agent host / server stack | server stack | **Server stack tier with replicas**, deployed with the API; not an agent role. |
| 4 | Supervisor shape | static config / backend-pushed | static first | **Static, idempotent reconcile** on boot, rerun or `SIGHUP`; dynamic dispatch is D1. |
| 5 | Secrets in the supervisor config | allowed / forbidden | forbidden | **Forbidden.** Config carries roles/models/counts only; secrets are fetched over the authenticated node channel. |
| 6 | Reviewer authority | comment only / full close | comment only | **Comment only for now.** Reviewers will later approve a small subset of small tickets; that bounded capability is `D10`, not part of this suite. |
| 7 | Planner publish path | direct push / guarded API | guarded API | **Confirmed:** planners draft and publish through the same guarded API path as workers; no direct repo pushes. |
| 8 | Reasoning effort | free-form / canonical enum + override | canonical enum | **Canonical `minimal|low|medium|high|max` default per model, optional per-runtime override.** Adapters map or clamp provider-specific values; reviewers may run at `max`. |

## Completion gate

- [x] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [x] Verification matrix in `03` is green and has a row for every requirement
- [x] `03` Results has a dated, non-placeholder row
- [x] `status` is `done` only after the implementation PR merged, and `pr` is set
- [x] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`
- [x] Review record in `03` shows all blocking findings resolved
- [x] Deferred register reflects what was actually left out

## Notes

- The clean cut is a recorded product decision, not an accident: this suite
  removes static `AGENT_ID`/`AGENT_API_KEY` auth, `agents.project_id`, the
  per-project enrollment token binding and the fused `providers.model/roles`
  columns instead of preserving them.
- PR #176 (`feat/agent-repo-from-server`) is an interim improvement that keeps
  server-derived repository coordinates and the `AGENT_MODE` compatibility
  switch. This suite absorbs the repository part and replaces the client-side
  mode with a server-enforced role.
- `fg-40` owns task graphs and handoffs between roles; this suite owns identity,
  model selection and fleet deployment. They meet at the runtime role and lease,
  and neither restates the other's scope.
- Dependent suites reconciled in this PR under `planning/README.md` rule 7:
  `fg-32`, `fg-38`, `fg-40`, `fg-41`, `fg-43`, `fg-44`, `fg-45`, `fg-46`,
  `fg-53`. Planned suites received targeted deltas; in-progress/deferred suites
  received relationship notes only.
