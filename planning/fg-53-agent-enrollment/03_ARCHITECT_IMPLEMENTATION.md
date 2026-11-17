# 03 — Implementation (fg-53)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

1. **Token schema and services** — add `054_agent_enrollment.sql` (+rollback),
   `AgentEnrollmentService` (mint/list/revoke/enroll/refresh) and token
   hashing/prefix helpers. Verify: service unit tests + migration dry-run.
2. **Auth middleware** — dispatch `at_…` access tokens and legacy `ak_…` keys,
   enforce expiry/revocation centrally, and move heartbeat onto the shared
   helper. Verify: `api-agent-auth` and heartbeat-expiry tests.
3. **Enrollment routes** — validators, rate limiters, generic failures, audit
   events, OpenAPI annotations, flag gating. Verify: route tests + bash suite.
4. **Revocation and retention** — cascade agent delete/revoke to token rows;
   add the daily purge job; expose enrollment metadata without secrets.
   Verify: revocation tests + retention test.
5. **Agent enrollment client** — `AgentConfig` precedence, credential store
   (0600/atomic), enroll on first boot, access-token use and refresh scheduler.
   Verify: `mvn test` + a Docker smoke test with a volume.
6. **Pool agents and long-running credentials** — configurable lifetime and a
   renewal path; remove the silent one-day expiry. Verify: >24h simulation test.
7. **Admin UI and docs** — `api/agentEnrollment.ts`, mint/list/revoke panel on
   the Agents page with a project selector, one-time token display; operator
   runbook in `02` → Rollout. Verify: Vitest + typecheck + build.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/054_agent_enrollment.sql` | CREATE | Token/event tables + `agents` enrollment columns/indexes |
| `backend/src/migrations/054_agent_enrollment_rollback.sql` | CREATE | Drop new columns then tables |
| `backend/src/migrations/apply.js` | MODIFY | Append migration after `053_harness_privacy.sql` |
| `backend/src/services/AgentEnrollmentService.js` | CREATE | Mint/list/revoke/enroll/refresh, hashing, transactions, audit |
| `backend/src/services/AgentTokenService.js` | CREATE | Token generation, prefix/hash, timing-safe compare, expiry helpers |
| `backend/src/validators/agentEnrollment.js` | CREATE | Joi schemas for mint/enroll/refresh/metadata |
| `backend/src/api/agentEnrollment.js` | CREATE | Routes + OpenAPI JSDoc, permission/membership checks, flag |
| `backend/src/api/v1/index.js` | MODIFY | Mount `/agent-enrollment` |
| `backend/src/middleware/auth.js` | MODIFY | Prefix dispatch, shared expiry/revocation check |
| `backend/src/api/v1/agentHeartbeat.js` | MODIFY | Use shared agent auth; enforce expiry |
| `backend/src/services/AgentService.js` | MODIFY | Revocation cascade, enrollment metadata, key-preview honesty |
| `backend/src/services/PoolManager.js` | MODIFY | Credential lifetime/renewal for pool agents |
| `backend/src/middleware/agentEnrollmentRateLimit.js` | CREATE | Per-IP/prefix limits for enroll/refresh/mint |
| `backend/src/services/AgentTokenCleanupService.js` | CREATE | Retention purge for token/audit rows |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | MODIFY | Enrollment/credential-file env + precedence |
| `agent/src/main/java/com/vibecode/agent/service/AgentEnrollmentClient.java` | CREATE | Enroll/refresh HTTP client |
| `agent/src/main/java/com/vibecode/agent/service/AgentCredentialStore.java` | CREATE | 0600 atomic load/save |
| `agent/src/main/java/com/vibecode/agent/service/AgentAuthManager.java` | CREATE | Access-token lifecycle, refresh timer, 401 retry |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | MODIFY | First-boot enrollment, auth manager wiring |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | Use `AgentAuthManager` token instead of static key |
| `agent/Dockerfile` / `agent/docker-compose*.yml` | MODIFY | Credential volume, `ENROLLMENT_TOKEN`/`ENROLLMENT_URL`, pass `AGENT_ID` |
| `agent/docker-compose.remote.yml.example` | CREATE | Remote-worker template without the API's Compose network |
| `agent/.env.example` | MODIFY | `AGENT_ID`, enrollment/credential variables, TLS note |
| `frontend/src/api/agentEnrollment.ts` | CREATE | Mint/list/revoke client |
| `frontend/src/views/AgentList.vue` | MODIFY | Enrollment tokens panel + project selector; one-time display |
| `frontend/src/__tests__/...` | CREATE | API/component/enrollment tests |
| `README.md` / `agent/.env.example` | MODIFY | Enrollment variables, TLS, credential volume; fix `AGENT_ID` docs |

## Dependencies

- Existing agent auth (`middleware/auth.js`, `AgentService`), permissions and
  project membership checks.
- Migration runner and rollback convention.
- Java agent build and image pipeline.
- Related: fg-43 (host deployment), fg-40 (multi-host), fg-41 (audit export).

## Migration notes

- File: `054_agent_enrollment.sql` + `054_agent_enrollment_rollback.sql`.
- Apply order: after `053_harness_privacy.sql` in the `apply.js` array.
- Additive only; no backfill. Existing agents keep working with
  `enrollment_token_id = NULL`.
- Rollback order: drop `agents` columns, then `agent_auth_events`,
  `agent_refresh_tokens`, `agent_access_tokens`, `agent_enrollment_tokens`.
- Verify with `cd backend && npm run db:migrate:dry-run` and a real PG
  integration run.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | mint returns raw token once, stores only hash/prefix, rejects bad TTL/max_uses/provider/permission | `cd backend && npm test` |
| FR2 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | list omits secrets; revoke blocks enrollment | `cd backend && npm test` |
| FR3 | backend unit + integration | `backend/src/__tests__/agentEnrollmentService.test.js`, `src/__tests__/integration/agentEnrollment.test.js` | valid enroll creates one agent; expired/revoked/exhausted create none; project/provider cannot be overridden | `cd backend && npm test && npm run test:integration` |
| FR4 | backend unit | `backend/src/__tests__/agentTokenAuth.test.js` | `at_` token authorizes; expired/revoked 401; prefix-index lookup | `cd backend && npm test` |
| FR5 | backend unit + integration | `backend/src/__tests__/agentEnrollmentService.test.js`, `src/__tests__/integration/agentEnrollment.test.js` | refresh rotates; old refresh fails; reuse revokes family | `cd backend && npm test && npm run test:integration` |
| FR6 | backend unit | `backend/src/__tests__/agentTokenAuth.test.js` | delete/revoke invalidates access, refresh and legacy tokens; other agents unaffected | `cd backend && npm test` |
| FR7 | agent unit + smoke | `agent/src/test/java/com/vibecode/agent/enrollment/AgentEnrollmentTest.java` | first boot enrolls; restart with volume skips enroll; file precedence; no secrets logged | `cd agent && mvn test` |
| FR8 | agent unit | `agent/src/test/java/com/vibecode/agent/enrollment/AgentAuthManagerTest.java` | refresh before expiry and on 401; bounded retries; exit on failure | `cd agent && mvn test` |
| FR9 | backend unit + agent unit | `backend/src/__tests__/api-agent-auth.test.js`, `AgentConfigTest` | legacy `ak_` keys work; prefix dispatch; feature flag off keeps legacy | `cd backend && npm test`; `cd agent && mvn test` |
| FR10 | backend unit | `backend/src/__tests__/agentHeartbeatExpiry.test.js` | expired key heartbeat 401; not reported online; all paths share check | `cd backend && npm test` |
| FR11 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | audit events for mint/revoke/enroll/refresh/reuse/expiry; redaction | `cd backend && npm test` |
| FR12 | backend unit + bash | `backend/src/__tests__/agentEnrollmentRateLimit.test.js`, `backend/integration-test/suites/agent_enrollment.test.sh` | burst 429; concurrent max_uses; generic errors | `cd backend && npm test`; `cd backend && bash integration-test/run.sh --only` |
| FR13 | backend integration | `backend/src/__tests__/integration/agentEnrollment.test.js` | DB failure leaves no rows; concurrent refresh has one winner | `cd backend && npm run test:integration` |
| FR14 | backend unit | `backend/src/__tests__/agentEnrollmentRoutes.test.js` | non-loopback HTTP rejected; HTTPS/dev flag accepted; proxy header | `cd backend && npm test` |
| FR15 | backend integration | `backend/src/__tests__/integration/poolAgentCredentials.test.js` | pool agent authenticates past 24h; lifetime configurable; renewal path | `cd backend && npm run test:integration` |
| FR16 | frontend unit | `frontend/src/__tests__/agentEnrollmentModal.test.ts`, `api-agentEnrollment.test.ts` | one-time display/copy; list/revoke; permission gating; no localStorage | `cd frontend && npm test -- --run` |
| FR17 | shell/config | `agent/docker-compose.yml`, `agent/docker-compose.remote.yml.example`, `agent/.env.example` | Compose config includes `AGENT_ID`; remote template has no external API network; env docs list enrollment vars | `docker compose -f agent/docker-compose.yml config`; `docker compose -f agent/docker-compose.remote.yml.example config` |
| NFR1 | backend unit | `backend/src/__tests__/agentEnrollmentService.test.js` | responses/logs/events contain no raw token; hash-only rows | `cd backend && npm test` |
| NFR2 | backend unit | `backend/src/__tests__/agentEnrollmentPermissions.test.js` | owner/member/admin/stranger matrix; cross-project token fails | `cd backend && npm test` |
| NFR3 | agent unit + frontend unit | `AgentCredentialStoreTest.java`, `agentEnrollmentModal.test.ts` | 0600 atomic write, temp cleanup; no secret in Pinia/localStorage | `cd agent && mvn test`; `cd frontend && npm test -- --run` |
| NFR4 | backend integration | `backend/src/__tests__/integration/agentEnrollment.test.js` | indexed lookup; enroll/refresh load targets | `cd backend && npm run test:integration` |
| NFR5 | backend integration + bash | migration rollback test, `agent_enrollment.test.sh` | legacy keys pass; rollback succeeds; flag-off behavior | `cd backend && npm run test:integration`; `bash integration-test/run.sh --only` |
| NFR6 | bash + docs | `backend/integration-test/suites/agent_enrollment.test.sh` | mint → enroll → refresh → revoke → 401; error codes match runbook | `cd backend && bash integration-test/run.sh --only` |
| NFR7 | backend unit | `backend/src/__tests__/agentTokenCleanup.test.js` | expired/revoked rows purged past retention; audit retention respected | `cd backend && npm test` |
| NFR8 | planning | `planning/check-planning.js` + this matrix | every FR/NFR has a row; tests named with IDs | `node planning/check-planning.js` |

## Verification commands

```bash
node planning/check-planning.js
cd backend  && npm test && npm run lint
cd frontend && npm test -- --run && npm run lint && npm run typecheck && npm run build
cd agent    && mvn test
# when applicable
cd backend  && npm run test:coverage && npm run test:integration
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

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
