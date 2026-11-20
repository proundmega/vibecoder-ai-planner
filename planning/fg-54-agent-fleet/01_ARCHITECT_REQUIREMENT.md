# 01 — Requirement (fg-54)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

A host serving five build workers and two reviewers needs seven hand-minted
identities, seven credential volumes and seven Compose invocations. Three root
causes make this necessary and unsafe:

1. **Identity is project-scoped.** `agents.project_id` binds a node to one
   project at enrollment, so the same host cannot serve two projects without
   re-enrolling, and grants cannot be revoked or narrowed independently of the
   credential.
2. **Credentials, models and roles are fused.** A `providers` row stores the API
   key, the model and `roles[]` together. Reusing one key for two models
   duplicates the secret; changing the model invalidates the provider an agent
   resolved; `roles` is advisory because `ProviderRouter.getForRole` has no
   production caller.
3. **Roles are client-asserted.** `AGENT_MODE=build|review` is read from the
   container env in `AgentConfig`; no backend route checks it. A misconfigured
   or compromised review node can claim build tickets, and the fleet has no
   auditable role assignment.

There is also no host-level unit: the deployment shape is one container per
agent, and nothing prevents deleting a credential or model that runtimes still
reference.

## Goals

1. One enrollment per **node** (host), independent of project, role and model.
2. Explicit, revocable `(node, project, role)` grants enforced by the backend.
3. Credentials and models as separate objects, with role tags on models and a
   manual add + test path when discovery is unsupported.
4. Runtimes as first-class records (`role`, `model`, `concurrency`) with
   server-side enforcement and per-lease project assignment.
5. One Compose stack per host: a supervisor reconciles declared runtimes
   idempotently, with no secrets in its config.
6. A `manager` service in the server stack, safe to replicate, that owns
   housekeeping and (later) desired-state decisions.
7. A clean cut: remove legacy static agent auth and fused provider columns
   rather than carrying a migration shim.

## Non-goals

- Task graphs, handoffs and worktree orchestration between roles (`fg-40`).
- Cost/budget policy and routing between models (`fg-38`); this suite only
  supplies the model metadata those policies consume.
- Sandbox isolation changes (`fg-34`) and workspace retention (`fg-44`).
- Reviewer merge authority and autonomous approval (`fg-36`, `fg-52`).
- Dynamic autoscaling of hosts or runtimes (deferred `D1`, `D5`).

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence | State |
|---|---|---|---|---|
| A1 | No production deployment depends on `ak_…` keys, `agents.project_id` or the fused `providers` columns | The clean-cut migration would destroy live identities | User approval recorded in `00` decisions; pre-implementation `git log`/deployment check | accepted |
| A2 | A supervisor can run N child JVMs in one container within the host memory budget | Per-host density target is wrong | Startup test with the documented `count × heap` budget; measured RSS | open |
| A3 | Model discovery is best-effort; manual entry plus the test button is the primary path | Providers without a list endpoint cannot be onboarded | Manual path is `FR7`; adapters are `D7` | accepted |
| A4 | One build runtime works on one project per lease; reviewers and planners may span their grants | Cross-project build reuse needs workspace/token resets per lease | Design constraint in `02`; enforced by `FR10` | accepted |
| A5 | Node-level trust (one credential per host, runtime header per child) is acceptable for v1 | A compromised runtime impersonates siblings on the same host | Same-host trust domain; per-runtime tokens deferred to `D2` | accepted |
| A6 | The manager can share the API image and database, and coordinate with Postgres locks | A separate service/DB would change deployment and migration order | `02` design; concurrency tests in `NFR4` | open |
| A7 | Providers expose reasoning effort under different names/values and support different ceilings | A single value can fail or be silently ignored | Canonical enum + adapter mapping/clamping; `FR19` tests each adapter | open |
| A8 | `harness_leases` remains the run-lease authority; `tickets.assigned_runtime_id` + `locked_at` is only a claim marker | Adding a second expiry would double-release tickets | Single-reaper design in `02`; `FR14` concurrency test | accepted |

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | A node enrolls with an owner-scoped join token and receives node credentials; enrollment does not take a project, role or provider | A token minted for owner O creates one `agent_nodes` row owned by O and returns a working credential pair; no project/role is stored on the node |
| FR2 | Runtime roles are a closed enum: `worker`, `reviewer`, `planner`; unknown values are rejected at the API and database | `POST` with `role=super-agent` returns 400/422; the enum check constraint rejects a direct insert |
| FR3 | Admins can create, list and revoke `(node, project, role)` grants | A grant row is created and visible; after revocation a claim for that project/role is denied |
| FR4 | The backend enforces the runtime role and project grant on claim, review and planning endpoints; the client cannot escalate by env or header | A review runtime calling a build claim gets 403 and an audit event; a runtime without a grant for project P cannot act on P |
| FR5 | Provider credentials are CRUD objects with an encrypted secret, `active|disabled` state and a monotonic version | Secret is encrypted at rest, never returned in plaintext, and a rotation keeps the same id with `version+1` |
| FR6 | Discovery can list models for a credential on explicit request; discovered models start `unverified` and disabled from runtime attachment | Discovery populates rows with `source=discovered`, `status=unverified`; no runtime can attach them until verified |
| FR7 | A model can be added manually with a name and optional capability metadata | Manual add creates a row with `source=manual`; it appears in the model list for that credential |
| FR8 | A model can be tested; the minimal call records `verified` or a stored error and timestamp | Test against a valid model sets `verified` and `last_verified_at`; an invalid model stores the provider error and stays unverified |
| FR9 | Models carry role tags; a runtime can only attach a model whose roles include the runtime role | Attaching a `reviewer` runtime to a model tagged `worker` is rejected |
| FR10 | Runtimes are records with node, role, model, concurrency and status; worker runtimes hold at most one active project assignment | Creating/updating a runtime persists the fields; a second active assignment for the same worker is rejected |
| FR11 | The supervisor reconciles a declared runtime set on boot, rerun and `SIGHUP`: spawn missing, drain removed, leave matching untouched | Applying the same config twice makes no changes; removing one entry drains and stops only that child |
| FR12 | Supervisor config carries no secrets; runtime provider/model credentials are fetched over the authenticated node channel | Config files and `docker inspect` show no API keys or tokens; the dedicated `provider-config` endpoint returns the decrypted key with the resolved model, endpoint and effort only to the owning node/runtime, sets `Cache-Control: no-store` and writes an audit event |
| FR13 | A manager service runs in the main Compose stack and can be replicated safely | Two replicas run; each housekeeping job executes once per tick across replicas |
| FR14 | The manager performs v1 housekeeping: stale-claim release (skipping active run leases), enrollment-token cleanup, runtime/node heartbeat expiry and legacy pool drain | Each job has an idempotent unit test and a two-replica test proving one effect per item; a ticket with an unexpired `harness_leases` row is never released |
| FR15 | The UI supports credential and model management (add, discover, test, role tags) and node/fleet management (grants, runtimes, drain, revoke) | Views call the new endpoints and show verified/unverified state and role tags |
| FR16 | The clean cut removes static agent auth, project-bound agents and the fused provider model/role columns, with a forward migration and rollback | Grep finds no production path for `AGENT_ID`/`AGENT_API_KEY`/`AGENT_AUTH_MODE`/`agents.project_id`/`api_key_hash`/`X-API-Key`; migration and rollback apply on an empty **and a seeded** DB |
| FR17 | Security-relevant actions write audit events: enrollment, grant changes, credential rotation/deletion attempts, provider-config reads, runtime state changes, role- and node-binding-denied requests | Each action produces an audit row with actor, node/runtime and outcome |
| FR18 | Deleting a credential or model that is referenced returns `409` with the referencing runtimes/models; deactivation and rotation remain available | Delete of an in-use credential returns 409 and leaves the row; delete after detaching succeeds |
| FR19 | Models carry a canonical reasoning-effort default (`minimal`, `low`, `medium`, `high`, `max`); runtimes may override it, and the resolved effort reaches the provider adapter | A model defaults to `medium`; a `reviewer` runtime overrides to `max` and the provider request carries the mapped value; an unknown value is rejected at the API and DB; unsupported provider values are clamped, never silently dropped |
| FR20 | Node-scoped routes bind `:id` to the presented node credential, and node listing is scoped to owned nodes or the caller's project memberships | A valid credential with a foreign `:id` gets 404 and no data; a member sees only nodes granted to their projects; a super_admin sees all |
| FR21 | JWT node/grant mutations require node ownership (or super_admin) plus project admin scope for the grant's project; grant deletion binds `grantId` to `nodeId` | A non-owner project admin cannot revoke/drain the node **or create/delete its grants**; deleting a grant with a mismatched `nodeId` returns 404; owner + project admin succeeds |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Authorization is deny-by-default and project-scoped; role and grant checks happen server-side on every mutating and claiming path | Tests assert 403 for missing grant, wrong role, cross-project access, and revoked credentials |
| NFR2 | Secrets stay encrypted and redacted: no plaintext key in responses, logs, audit rows, supervisor config or process argv | Unit tests assert redaction; `docker inspect`/log capture contains no secret |
| NFR3 | Reconcile is idempotent and crash-safe: no duplicate children, no orphaned children after supervisor restart | Apply-twice test; kill -9 supervisor, restart, assert exact expected child set |
| NFR4 | Manager replicas produce no duplicate side effects under concurrency | Two manager instances run the same job window; one lease release/one cleanup per item |
| NFR5 | The clean cut is explicitly documented; migrations are reversible and no backfill is attempted | README/agent docs state the clean cut; up/down migrations pass in CI |
| NFR6 | Reconciliation of 50 runtimes completes within 30 s and does not busy-loop | Timing assertion in the supervisor integration test; idle CPU below 2% |
| NFR7 | Node and runtime liveness is observable: heartbeat timestamps, status transitions and structured log events | Tests assert heartbeat updates; status endpoint exposes node/runtime state |
| NFR8 | The migration order, rollback and `apply.js` registration are correct and documented | `npm run db:migrate` then rollback succeeds on a fresh database |

## In scope

- `agent_nodes`, `agent_node_grants`, `agent_runtimes`, node enrollment tokens.
- `provider_credentials` + `provider_models` with discovery, manual add, test,
  role tags and reasoning-effort defaults/overrides.
- Server-side role and grant enforcement; lease/project assignment rules.
- Supervisor mode in the agent image; one host Compose stack.
- `manager` service with replicas and housekeeping jobs.
- Frontend fleet and registry screens.
- Clean-cut removal of legacy agent auth and fused provider columns.
- Documentation rewrite for the new model.

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| API routes/contracts | New node/grant/runtime and credential/model routes; claim/review routes gain role checks | `02` API contract |
| Database/migrations | New tables and FKs; `agents` renamed/replaced; legacy columns dropped | `056_agent_fleet.sql` |
| Frontend | New/reworked Agents, Fleet and Providers views; API client additions | `02` design |
| Agent/harness | Supervisor entrypoint, role/model config, child process lifecycle, no static auth | `02`, `03` |
| Permissions/auth | No new permission codes: nodes use `AGENT_READ/CREATE/REVOKE/DELETE`; registry reuses `PROJECT_MANAGE_MEMBERS`; agent auth switches to node credential + runtime header | `02` API contract |
| Background jobs/external calls | Manager service jobs; provider discovery/test calls | `FR13`, `FR14` |
| Downstream tickets | Reconciled in this PR: `fg-32`, `fg-38`, `fg-40`, `fg-41`, `fg-43`, `fg-44`, `fg-45`, `fg-46`, `fg-53` (relationship notes and the required deltas) | `planning/README.md` rule 7 |
| Rollback | Revert the PR and run the rollback migration; no data backfill to preserve | `NFR5` |

## Out of scope

Summarise only. The authoritative list — with reasons and follow-ups — is
**`00` → Deferred register**.

- Dynamic desired-state dispatch — `D1`
- Per-runtime credentials — `D2`
- Host autoscaling — `D5`
- Pricing/routing — `D4`, fg-38
- Reviewer merge authority — `D10`, fg-36/fg-52

## Open questions

Product decisions (reviewer authority, planner publish path) are recorded in
**`00` → Decisions needed from the user**. Remaining design questions:

| # | Question | Assumption if unanswered |
|---|---|---|
| 1 | Should grants be node-level, runtime-model-level, or both? | Node-level grants; runtime role narrows them (`02`) |
| 2 | What is the default concurrency for a build runtime? | `1` ticket per runtime; raised deliberately with a model that supports it |

## Dependencies

- Depends on: `fg-53` (enrollment primitives, merged as #174); PR #176 for
  server-derived repository coordinates (in review).
- Consumed by: `fg-38` (model metadata), `fg-40` (roles/leases), `fg-43`
  (host sizing), `fg-44` (workspace lifecycle).
- Supersedes: the container-per-agent deployment shape in `fg-43` and the
  static `AGENT_MODE` role decision from #176.
