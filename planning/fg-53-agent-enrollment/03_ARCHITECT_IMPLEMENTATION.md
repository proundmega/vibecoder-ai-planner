# 03 — Implementation (fg-53)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

1. **Token schema and services** — add `054_agent_enrollment.sql` (+rollback),
   `agents.project_id`, refresh `family_id`, the encrypted idempotency replay
   cache, `AgentEnrollmentService` (mint/list/revoke/enroll/refresh) and token
   hashing/prefix helpers. Verify: service unit tests + migration dry-run.
2. **Auth middleware and project scope** — dispatch `at_…` access tokens and
   legacy `ak_…` keys, enforce expiry/revocation centrally, load
   `project_id` into `req.agent`, and add the project-scope assertion used by
   ticket and other agent-facing project routes; make harness project
   observability/privacy/budget/kill-switch routes JWT-only. Verify:
   `api-agent-auth`, heartbeat-expiry and cross-project tests.
3. **Enrollment routes** — validators, rate limiters, generic failures, audit
   events, OpenAPI annotations, flag gating. Verify: route tests + bash suite.
4. **Revocation, replay and retention** — cascade agent delete/revoke to token
   rows; implement the idempotency-key replay cache (same key → same pair,
   different/absent key → family revoke); add the daily purge job; expose
   enrollment metadata without secrets. Verify: revocation, same-key,
   different-key, concurrent-refresh, lost-response and retention tests.
5. **Agent enrollment client** — `AgentConfig` precedence, credential store
   (0600/atomic) including `projectId`, enroll on first boot, access-token use
   and a single-flight refresh scheduler that coalesces timer/401 triggers. Verify: `mvn test` + the Docker smoke test with a
   persistent volume/restart.
6. **Pool agents and long-running credentials** — configurable lifetime and a
   renewal path; remove the silent one-day expiry. Verify: >24h simulation test.
7. **Metrics and admin UI/docs** — enrollment/refresh counters and failure
   counters in `metrics.js`; `api/agentEnrollment.ts`, mint/list/revoke panel
   on the Agents page with a project selector, one-time token display; operator
   runbook in `02` → Rollout. Verify: metrics assertions + Vitest + typecheck +
   build.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/054_agent_enrollment.sql` | CREATE | Token/event tables + `agents` enrollment columns/indexes |
| `backend/src/migrations/054_agent_enrollment_rollback.sql` | CREATE | Drop new columns then tables |
| `backend/src/migrations/apply.js` | MODIFY | Append migration after `053_harness_privacy.sql` |
| `backend/src/services/AgentEnrollmentService.js` | CREATE | Mint/list/revoke/enroll/refresh, hashing, transactions, audit |
| `backend/src/services/AgentTokenService.js` | CREATE | Token generation, prefix/hash, timing-safe compare, expiry helpers |
| `backend/src/services/AgentRefreshReplayService.js` | CREATE | Encrypted idempotency replay cache lookup/store/purge |
| `backend/src/validators/agentEnrollment.js` | CREATE | Joi schemas for mint/enroll/refresh/metadata |
| `backend/src/api/agentEnrollment.js` | CREATE | Routes + OpenAPI JSDoc, permission/membership checks, flag |
| `backend/src/api/v1/index.js` | MODIFY | Mount `/agent-enrollment` |
| `backend/src/middleware/auth.js` | MODIFY | Prefix dispatch, shared expiry/revocation check, load `project_id` into `req.agent` |
| `backend/src/middleware/agentProjectScope.js` | CREATE | Assert `req.agent.project_id` matches the ticket/credential project; legacy NULL keeps owner scope |
| `backend/src/services/TicketService.js` | MODIFY | Enforce `agentProjectId` on create and `getOne`/list/read/write paths before owner/admin bypass |
| `backend/src/api/tickets.js` | MODIFY | Apply project-scope assertion to agent ticket list/read/status/message/phase/review routes |
| `backend/src/api/projects.js` | MODIFY | Apply project-scope assertion to agent `POST /projects/:id/tickets` |
| `backend/src/controllers/ticketController.js` | MODIFY | Resolve/pass the ticket project to the scope assertion |
| `backend/src/controllers/projectController.js` | MODIFY | Enforce the agent project on `createProjectTicket` before creation |
| `backend/src/api/ticketPlanning.js` | MODIFY | Apply the project-scope assertion to agent planning reads |
| `backend/src/api/github.js` | MODIFY | Apply the project-scope assertion to agent repo/token routes |
| `backend/src/api/repoProfiles.js` | MODIFY | Apply the project-scope assertion to agent repo-profile routes |
| `backend/src/api/review.js` | MODIFY | Apply the project-scope assertion to the agent local-diff route |
| `backend/src/api/harnessRuns.js` | MODIFY | Apply the project-scope assertion to agent lease/run routes |
| `backend/src/api/harnessObservability.js` | MODIFY | Make project observability/privacy/budget/kill-switch routes JWT-only; keep run-scoped agent routes project-asserted |
| `backend/src/api/v1/agentHeartbeat.js` | MODIFY | Use shared agent auth; enforce expiry on heartbeat and status paths |
| `backend/src/services/AgentService.js` | MODIFY | Revocation cascade, `project_id` persistence/return, enrollment metadata, key-preview honesty |
| `backend/src/metrics.js` | MODIFY | Enrollment/refresh and auth-failure counters/histograms |
| `backend/src/services/PoolManager.js` | MODIFY | Credential lifetime/renewal for pool agents |
| `backend/src/middleware/agentEnrollmentRateLimit.js` | CREATE | Per-IP/prefix limits for enroll/refresh/mint |
| `backend/src/services/AgentTokenCleanupService.js` | CREATE | Retention purge for token/audit rows using the expiry indexes |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | MODIFY | Enrollment/credential-file env + precedence; `PROJECT_ID` optional in enrollment mode |
| `agent/src/main/java/com/vibecode/agent/service/AgentEnrollmentClient.java` | CREATE | Enroll/refresh HTTP client |
| `agent/src/main/java/com/vibecode/agent/service/AgentCredentialStore.java` | CREATE | 0600 atomic load/save, including `projectId` |
| `agent/src/main/java/com/vibecode/agent/service/AgentAuthManager.java` | CREATE | Access-token lifecycle, single-flight refresh timer/401 coalescing, idempotency-key reuse |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | MODIFY | First-boot enrollment, auth manager wiring |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | Use `AgentAuthManager` token instead of static key |
| `agent/Dockerfile` / `agent/docker-compose*.yml` | MODIFY | Credential volume, `ENROLLMENT_TOKEN`/`ENROLLMENT_URL`, pass `AGENT_ID` |
| `agent/docker-compose.remote.yml.example` | CREATE | Remote-worker template without the API's Compose network |
| `agent/.env.example` | MODIFY | `AGENT_ID`, enrollment/credential variables, TLS note |
| `agent/scripts/agent-enrollment-smoke.sh` | CREATE | Docker enroll → restart-with-volume check |
| `backend/src/__tests__/agentProjectScope.test.js` | CREATE | Cross-project ticket read/list/write/create, planning, GitHub, harness and credential scope matrix |
| `backend/src/__tests__/harnessObservabilityAuth.test.js` | CREATE | Agent tokens rejected on project observability/privacy/budget/kill-switch routes; JWT membership checks |
| `backend/src/__tests__/integration/agentEnrollmentLoad.test.js` | CREATE | 100 enrollments / 1,000 refreshes with p95 evidence |
| `backend/src/__tests__/agentEnrollmentMetrics.test.js` | CREATE | Enrollment/refresh/replay-cache-hit/reuse/failure counter assertions |
| `backend/package.json` | MODIFY | Add the `test:load:agent-enrollment` script |
| `frontend/src/api/agentEnrollment.ts` | CREATE | Mint/list/revoke client |
| `frontend/src/views/AgentList.vue` | MODIFY | Enrollment tokens panel + project selector; one-time display |
| `frontend/src/__tests__/...` | CREATE | API/component/enrollment tests |
| `README.md` | MODIFY | Enrollment variables, TLS, credential volume; fix `AGENT_ID` docs |

## Dependencies

- Existing agent auth (`middleware/auth.js`, `AgentService`), permissions and
  project membership checks.
- Migration runner and rollback convention.
- Java agent build and image pipeline.
- `agents.project_id` is added by this ticket for enrolled agents; the broader
  manual/legacy project-agent migration is deferred in `00` D11.
- Related: fg-43 (host deployment), fg-40 (multi-host), fg-41 (audit export).

## Migration notes

- File: `054_agent_enrollment.sql` + `054_agent_enrollment_rollback.sql`.
- Apply order: after `053_harness_privacy.sql` in the `apply.js` array.
- Additive only; no backfill. Existing agents keep working with
  `project_id = NULL` and `enrollment_token_id = NULL`.
- Rollback order: drop the `agents` project/enrollment columns and index, then
  `agent_auth_events`, `agent_refresh_replays`, `agent_refresh_tokens`,
  `agent_access_tokens`, `agent_enrollment_tokens`.
- Verify with `cd backend && npm run db:migrate:dry-run` and a real PG
  integration run.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | [FR1] mint returns raw token once, stores only hash/prefix, rejects bad TTL/max_uses/provider/permission | `cd backend && npm test` |
| FR2 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | [FR2] list omits secrets; revoke blocks enrollment | `cd backend && npm test` |
| FR3 | backend unit + integration | `backend/src/__tests__/agentEnrollmentService.test.js`, `agentProjectScope.test.js`, `src/__tests__/integration/agentEnrollment.test.js` | [FR3] enroll creates one agent with the token project; expired/revoked/exhausted create none; project/provider cannot be overridden; issued token serves its project and 403s another project | `cd backend && npm test && npm run test:integration` |
| FR4 | backend unit | `backend/src/__tests__/agentTokenAuth.test.js` | [FR4] `at_` token authorizes; expired/revoked 401; prefix-index lookup | `cd backend && npm test` |
| FR5 | backend unit + integration | `backend/src/__tests__/agentEnrollmentService.test.js`, `src/__tests__/integration/agentEnrollment.test.js` | [FR5] refresh rotates; same idempotency key returns the identical pair; a stolen rotated token replayed with a different/absent key gets no new pair and revokes the family; audit reason | `cd backend && npm test && npm run test:integration` |
| FR6 | backend unit | `backend/src/__tests__/agentTokenAuth.test.js` | [FR6] delete/revoke invalidates access, refresh and legacy tokens; other agents unaffected | `cd backend && npm test` |
| FR7 | agent unit + Docker smoke | `agent/src/test/java/com/vibecode/agent/enrollment/AgentEnrollmentTest.java`, `agent/scripts/agent-enrollment-smoke.sh` | [FR7] first boot enrolls without `PROJECT_ID`; credential file stores `projectId`; restart with volume skips enroll; file precedence; no secrets logged | `cd agent && mvn test`; `bash agent/scripts/agent-enrollment-smoke.sh` |
| FR8 | agent unit | `agent/src/test/java/com/vibecode/agent/enrollment/AgentAuthManagerTest.java` | [FR8] refresh before expiry and on 401; simultaneous timer+401 triggers coalesce to one request/key; lost-response retry reuses the key and gets the same pair; bounded retries; exit on failure | `cd agent && mvn test` |
| FR9 | backend unit + agent unit | `backend/src/__tests__/api-agent-auth.test.js`, `AgentConfigTest` | [FR9] legacy `ak_` keys work; prefix dispatch; feature flag off keeps legacy | `cd backend && npm test`; `cd agent && mvn test` |
| FR10 | backend unit | `backend/src/__tests__/agentHeartbeatExpiry.test.js` | [FR10] expired key 401 on heartbeat and agent-status routes; not reported online; all paths share the check | `cd backend && npm test` |
| FR11 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | [FR11] audit events for mint/revoke/enroll/refresh/replay-cache-hit/reuse/expiry; redaction | `cd backend && npm test` |
| FR12 | backend unit + bash | `backend/src/__tests__/agentEnrollmentRateLimit.test.js`, `backend/integration-test/suites/agent_enrollment.test.sh` | [FR12] burst 429; concurrent max_uses; generic errors | `cd backend && npm test`; `cd backend && bash integration-test/run.sh --only` |
| FR13 | backend integration | `backend/src/__tests__/integration/agentEnrollment.test.js` | [FR13] DB failure leaves no rows; concurrent same-key refresh yields one rotation and the same pair; winner token works; different/absent-key replay revokes | `cd backend && npm run test:integration` |
| FR14 | backend unit | `backend/src/__tests__/agentEnrollmentRoutes.test.js` | [FR14] non-loopback HTTP rejected; HTTPS/dev flag accepted; proxy header | `cd backend && npm test` |
| FR15 | backend integration | `backend/src/__tests__/integration/poolAgentCredentials.test.js` | [FR15] pool agent authenticates past 24h; lifetime configurable; renewal path | `cd backend && npm run test:integration` |
| FR16 | frontend unit | `frontend/src/__tests__/agentEnrollmentModal.test.ts`, `api-agentEnrollment.test.ts` | [FR16] one-time display/copy; list/revoke; permission gating; no localStorage | `cd frontend && npm test -- --run` |
| FR17 | shell/config | `agent/docker-compose.yml`, `agent/docker-compose.remote.yml.example`, `agent/.env.example` | [FR17] Compose config includes `AGENT_ID`; remote template has no external API network; env docs list enrollment vars | `docker compose -f agent/docker-compose.yml config`; `docker compose -f agent/docker-compose.remote.yml.example config` |
| NFR1 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | [NFR1] responses/logs/events contain no raw token; hash-only token rows; replay cache is encrypted, TTL-bounded and returns only the matching retry | `cd backend && npm test` |
| NFR2 | backend unit + integration | `backend/src/__tests__/agentEnrollmentPermissions.test.js`, `agentProjectScope.test.js`, `harnessObservabilityAuth.test.js`, `src/__tests__/integration/agentEnrollment.test.js` | [NFR2] owner/member/admin/stranger matrix; cross-project token use fails; enrolled agent cannot create/list/read/pick up/edit/release another project’s ticket, planning, GitHub or harness resource, and is rejected from project observability/privacy/budget/kill-switch routes; credential access and token purge keep scope | `cd backend && npm test && npm run test:integration` |
| NFR3 | agent unit + frontend unit | `AgentCredentialStoreTest.java`, `agentEnrollmentModal.test.ts` | [NFR3] 0600 atomic write, temp cleanup; no secret in Pinia/localStorage | `cd agent && mvn test`; `cd frontend && npm test -- --run` |
| NFR4 | backend integration + load | `backend/src/__tests__/integration/agentEnrollmentLoad.test.js` | [NFR4] indexed lookups; 100 enrollments and 1,000 refreshes with p95 targets from `02` | `cd backend && npm run test:load:agent-enrollment` |
| NFR5 | backend integration + bash | migration rollback test, `agent_enrollment.test.sh` | [NFR5] legacy keys pass; rollback succeeds; flag-off behavior | `cd backend && npm run test:integration`; `bash integration-test/run.sh --only` |
| NFR6 | bash + metrics + docs | `backend/integration-test/suites/agent_enrollment.test.sh`, `backend/src/__tests__/agentEnrollmentMetrics.test.js` | [NFR6] mint → enroll → refresh → revoke → 401; error codes match runbook; counters emitted | `cd backend && bash integration-test/run.sh --only`; `cd backend && npm test` |
| NFR7 | backend unit | `backend/src/__tests__/agentTokenCleanup.test.js` | [NFR7] expired/revoked rows purged past retention; audit retention respected; expiry indexes used | `cd backend && npm test` |
| NFR8 | planning | `planning/check-planning.js` + this matrix | [NFR8] every FR/NFR has a row; test cases carry requirement IDs | `node planning/check-planning.js` |

## Verification commands

```bash
node planning/check-planning.js
cd backend  && npm test && npm run lint
cd frontend && npm test -- --run && npm run lint && npm run typecheck && npm run build
cd agent    && mvn test
# Docker enrollment smoke: enroll, restart with the volume, verify no re-enroll
bash agent/scripts/agent-enrollment-smoke.sh
# when applicable
cd backend  && npm run test:coverage && npm run test:integration
cd backend  && npm run test:load:agent-enrollment
cd backend  && bash integration-test/run.sh --only
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
| 0 | pending | | | |
| 1 | independent review (PR #173) | Project scoping was not stored/enforced; refresh replay could revoke a concurrent/lost-response winner. | Added `agents.project_id` + route enforcement and tests; added refresh `family_id` + grace window and concurrent/lost-response/reuse tests. Non-blocking verification, metrics, credential-file, decision, index and retention-index gaps also closed. | superseded by round 2 |
| 2 | independent review (PR #173) | Grace replay could mint a fresh pair for a stolen old token; project scope missed ticket read/list and several agent routes. | Replaced grace with an encrypted idempotency replay cache (same key → same pair; different/absent key → family revoke) and negative theft tests; added the exhaustive agent route inventory and read/list cross-project tests. | superseded by round 3 |
| 3 | independent review (PR #173) | `POST /projects/:id/tickets` missing from the inventory/enforcement; client timer/401 refreshes could race with different keys; heartbeat method typo; duplicate `TicketService.js` row. | Added route/controller/`TicketService.create` scope + create test; specified single-flight refresh and coalescing; corrected `POST /agents-status/:id/heartbeat`; merged the file row. | superseded by round 4 |
| 4 | independent review (PR #173) | Harness project observability/privacy/budget/kill-switch routes were agent-authenticated without project scope; idempotency-key wire convention inconsistent. | Made the project/global harness operator routes JWT-only and added auth tests; kept run-scoped agent routes project-asserted; standardized on the body `idempotency_key`; added the handler-auth provider-config route to the self-scoped inventory. | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
