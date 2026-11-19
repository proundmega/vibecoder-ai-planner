# 03 — Implementation (fg-54)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

Ordered slices. Each slice should be independently verifiable.

1. **Schema and models** — `agent_nodes`, `agent_node_grants`,
   `agent_runtimes`, `provider_credentials`, `provider_models`,
   `agent_node_enrollment_tokens`, lease columns; rollback. Verify:
   `npm run db:migrate` + rollback on a fresh DB.
2. **Node enrollment and auth** — owner-scoped join tokens, node credential
   pair, runtime header resolution; remove static agent auth. Verify: enroll →
   config → heartbeat tests and a 401 for static keys.
3. **Role and grant enforcement** — closed enum, role middleware, project
   assignment rules on claim/review/planning. Verify: 403 matrix tests.
4. **Credential/model registry** — CRUD, encrypted secret, rotation,
   discovery, manual add, test, reasoning effort, reference guards. Verify:
   registry tests + redaction assertions.
5. **Supervisor** — `SUPERVISOR_CONFIG`, child spawn, deterministic names,
   reconcile, drain, SIGHUP; no secrets in config. Verify: apply-twice,
   remove-one, kill -9 tests.
6. **Manager service** — Compose service, replicas, advisory locks,
   `SKIP LOCKED` jobs. Verify: two-replica test.
7. **Frontend** — fleet and registry screens, API client. Verify:
   `npm test -- --run`, typecheck, lint.
8. **Clean cut and docs** — remove legacy paths, rewrite `README.md` and
   `agent/ENROLLMENT.md`, record the approved cut. Verify: grep checks + full
   suites.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/056_agent_fleet.sql` | CREATE | New tables, rename, dropped legacy columns |
| `backend/src/migrations/056_agent_fleet_rollback.sql` | CREATE | Reverse the migration |
| `backend/src/migrations/apply.js` | MODIFY | Register 056 after 055 |
| `backend/src/models/agentNode.js` | CREATE | Node + grant persistence |
| `backend/src/models/agentRuntime.js` | CREATE | Runtime persistence and lease helpers |
| `backend/src/models/providerCredential.js` | CREATE | Credential + model persistence |
| `backend/src/models/ticket.js` | MODIFY | `assigned_runtime_id`, `lease_expires_at` |
| `backend/src/services/AgentNodeService.js` | CREATE | Enroll, config, heartbeat, revoke/drain |
| `backend/src/services/AgentRoleService.js` | CREATE | Role/grant resolution and denial audit |
| `backend/src/services/ProviderRegistryService.js` | CREATE | Credential/model CRUD, discovery, test, guards |
| `backend/src/services/AgentEnrollmentService.js` | MODIFY | Node-scoped tokens; remove project/provider binding |
| `backend/src/services/AgentService.js` | MODIFY | Runtime records, no project-bound agent |
| `backend/src/services/TicketService.js` | MODIFY | Claim by runtime + grant; lease expiry |
| `backend/src/services/PoolManager.js` | MODIFY | Stop container-per-agent creation; manager owns reconciliation |
| `backend/src/api/agentNodes.js` | CREATE | Node, grant, config, heartbeat routes |
| `backend/src/api/providerRegistry.js` | CREATE | Credential/model routes |
| `backend/src/api/agents.js` | MODIFY | Runtime header auth; remove static-key paths |
| `backend/src/api/agentEnrollment.js` | MODIFY | Node enrollment routes; remove project/provider fields |
| `backend/src/api/providers.js` | MODIFY | Delegate to the registry service |
| `backend/src/middleware/agentRuntimeAuth.js` | CREATE | Node credential + `X-Agent-Runtime` resolution |
| `backend/src/middleware/agentRole.js` | CREATE | Role/grant checks and denial audit |
| `backend/src/manager/index.js` | CREATE | Manager entrypoint and job loop |
| `backend/src/manager/jobs/*.js` | CREATE | Lease reaper, token cleanup, heartbeat expiry, pool reconcile |
| `docker-compose.yml` | MODIFY | `manager` service (replicas, healthcheck, internal only) |
| `agent/src/main/java/com/vibecode/agent/supervisor/Supervisor.java` | CREATE | Config parse, reconcile, signals, child lifecycle |
| `agent/src/main/java/com/vibecode/agent/supervisor/RuntimeConfig.java` | CREATE | ini model, no-secret validation |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | MODIFY | Runtime mode: role from server, no `AGENT_MODE` |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | MODIFY | Remove static auth and client role; runtime id/role |
| `agent/src/main/java/com/vibecode/agent/service/AgentAuthManager.java` | MODIFY | Node credentials only |
| `agent/src/main/java/com/vibecode/agent/service/RuntimeApi.java` | CREATE | Config/heartbeat/claim with runtime header |
| `agent/src/main/java/com/vibecode/agent/service/ProviderEffort.java` | CREATE | Canonical effort mapping/clamping per provider |
| `agent/agent.ini.example` | CREATE | Supervisor config example, secrets forbidden |
| `agent/docker-compose.yml` | MODIFY | Supervisor entrypoint; one service |
| `agent/docker-compose.remote.yml.example` | MODIFY | Same, single stack |
| `frontend/src/api/agentNodes.ts` | CREATE | Node/grant/runtime client |
| `frontend/src/api/providerRegistry.ts` | CREATE | Credential/model client |
| `frontend/src/views/AgentList.vue` | MODIFY | Fleet view: nodes, grants, runtimes, drain/revoke |
| `frontend/src/views/AgentDetail.vue` | MODIFY | Runtime status and role, no static key |
| `frontend/src/views/Providers.vue` | MODIFY | Credentials + models with add/test/role tags |
| `README.md`, `agent/ENROLLMENT.md` | MODIFY | New model; explicit clean-cut note |
| `backend/src/__tests__/agentFleet*.test.js` | CREATE | Backend unit/route coverage |
| `backend/src/__tests__/integration/agentFleet.integration.test.js` | CREATE | Migration, lease, replica behaviour |
| `frontend/src/__tests__/agentFleet.test.ts` | CREATE | Fleet/registry views |
| `agent/src/test/java/com/vibecode/agent/supervisor/*Test.java` | CREATE | Reconcile, drain, no-secret config |

Exact imports and signatures belong in `04` per slice when implementation
starts; this table is the expected shape, not a frozen diff.

## Dependencies

- fg-53 primitives: token hashing, refresh rotation, credential store, audit.
- PR #176: server-derived repository coordinates (kept).
- fg-38: consumes `provider_models` metadata; not required to start.
- fg-40: consumes runtime roles and leases; not required to start.
- fg-43/fg-44: host sizing and workspace retention; the supervisor consumes
  their numbers but does not block on them.

## Migration notes

- File: `056_agent_fleet.sql` + `056_agent_fleet_rollback.sql`
- Apply order: after `055_agent_enrollment.sql` in `apply.js`
- Backfill: none. The clean cut is approved in `00`; no legacy key or
  project-binding data is preserved.
- Renames: `agents → agent_runtimes`; `tickets.assigned_agent_id →
  assigned_runtime_id`. Postgres preserves FKs on `ALTER TABLE ... RENAME`;
  re-verify every call site with `grep -rn assigned_agent_id backend/src`.
- Rollback risk: dropping new tables discards node/runtime identities; with no
  deployments that is the intended behaviour.

## Verification matrix (canonical)

One row per requirement. This table is the contract between `01` and the code.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | backend route | `backend/src/__tests__/agentNodes.test.js` | `FR1 enrolls a node without project or role` | `npm test` |
| FR2 | backend unit | `backend/src/__tests__/agentNodes.test.js` | `FR2 rejects an unknown role` | `npm test` |
| FR3 | backend route | `backend/src/__tests__/agentNodes.test.js` | `FR3 creates and revokes a grant` | `npm test` |
| FR4 | backend route | `backend/src/__tests__/agentRoleEnforcement.test.js` | `FR4 denies a build claim for a reviewer runtime` | `npm test` |
| FR5 | backend unit | `backend/src/__tests__/providerRegistry.test.js` | `FR5 encrypts the secret and rotates in place` | `npm test` |
| FR6 | backend unit | `backend/src/__tests__/providerRegistry.test.js` | `FR6 discovery creates unverified models` | `npm test` |
| FR7 | backend route | `backend/src/__tests__/providerRegistry.test.js` | `FR7 adds a manual model` | `npm test` |
| FR8 | backend unit | `backend/src/__tests__/providerRegistry.test.js` | `FR8 test marks verified or stores the error` | `npm test` |
| FR9 | backend unit | `backend/src/__tests__/agentNodes.test.js` | `FR9 rejects a role not tagged on the model` | `npm test` |
| FR10 | backend unit | `backend/src/__tests__/agentRuntime.test.js` | `FR10 worker accepts one active project` | `npm test` |
| FR11 | agent unit | `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorReconcileTest.java` | `FR11 apply twice is a no-op; remove one drains only that child` | `mvn test` |
| FR11 | agent integration | `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorIntegrationTest.java` | `FR11 kill -9 then restart yields the exact child set` | `mvn test` |
| FR12 | agent unit | `agent/src/test/java/com/vibecode/agent/supervisor/RuntimeConfigTest.java` | `FR12 rejects secrets and unknown keys in the ini` | `mvn test` |
| FR13 | backend integration | `backend/src/__tests__/integration/agentFleet.integration.test.js` | `FR13 two manager replicas run one job each` | `npm run test:integration` |
| FR14 | backend unit | `backend/src/__tests__/managerJobs.test.js` | `FR14 each job is idempotent` | `npm test` |
| FR15 | frontend unit | `frontend/src/__tests__/agentFleet.test.ts` | `FR15 renders verified state and role tags` | `npm test -- --run` |
| FR16 | backend integration | `backend/src/__tests__/integration/agentFleet.integration.test.js` | `FR16 migrate and rollback on a fresh database` | `npm run test:integration` |
| FR17 | backend route | `backend/src/__tests__/agentNodes.test.js` | `FR17 audit rows for enrollment and grant changes` | `npm test` |
| FR18 | backend route | `backend/src/__tests__/providerRegistry.test.js` | `FR18 delete in-use credential returns 409` | `npm test` |
| FR19 | backend unit | `backend/src/__tests__/providerRegistry.test.js` | `FR19 resolves model effort default and runtime override` | `npm test` |
| FR19 | agent unit | `agent/src/test/java/com/vibecode/agent/service/ProviderEffortTest.java` | `FR19 maps and clamps effort per provider` | `mvn test` |
| NFR1 | backend route | `backend/src/__tests__/agentRoleEnforcement.test.js` | `NFR1 deny-by-default matrix` | `npm test` |
| NFR2 | backend unit | `backend/src/__tests__/providerRegistry.test.js` | `NFR2 no secret in responses or logs` | `npm test` |
| NFR2 | agent unit | `agent/src/test/java/com/vibecode/agent/supervisor/RuntimeConfigTest.java` | `NFR2 no secret in config or argv` | `mvn test` |
| NFR3 | agent unit | `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorReconcileTest.java` | `NFR3 reconcile is crash-safe` | `mvn test` |
| NFR4 | backend integration | `backend/src/__tests__/integration/agentFleet.integration.test.js` | `NFR4 replicas produce one effect per item` | `npm run test:integration` |
| NFR5 | docs | `README.md`, `agent/ENROLLMENT.md` | `NFR5 clean-cut note present; rollback documented` | grep check |
| NFR6 | agent unit | `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorReconcileTest.java` | `NFR6 50 runtimes reconcile under 30s` | `mvn test` |
| NFR7 | backend route | `backend/src/__tests__/agentNodes.test.js` | `NFR7 heartbeat updates status and timestamps` | `npm test` |
| NFR8 | backend integration | `backend/src/__tests__/integration/agentFleet.integration.test.js` | `NFR8 apply.js ordering and rollback` | `npm run test:integration` |

A requirement with no row is not done. Name each test with its ID (`FR1` in the
test name) so traceability can map requirement → code → test → verification.

## Verification commands

The standard set lives in `planning/ENGINEERING_STANDARDS.md` →
*Definition of done*. Ticket-specific additions:

```bash
node planning/check-planning.js
cd backend && npm test
cd backend && npm run test:integration
cd frontend && npm test -- --run && npm run typecheck && npm run lint
cd agent && mvn -B test
grep -rn "assigned_agent_id\|AGENT_API_KEY\|AGENT_ID" backend/src agent/src | grep -v __tests__
```

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built
- [ ] `check-planning.js` passes; no status/claim/index mismatch
- [ ] Independent reviewer evidence is recorded; every blocking finding is resolved
- [ ] `status: done` only if the implementation PR is merged and Results is non-placeholder
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | pending planning review | — | — | — |

## Results

No implementation has started; there are no verification results yet.
