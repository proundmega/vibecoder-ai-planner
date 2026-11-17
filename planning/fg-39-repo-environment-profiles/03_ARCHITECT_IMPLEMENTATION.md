# 03 — Implementation (fg-39)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

### Slice 2 — services and Slice 5 — editor

- [x] Profile schema + agent model for bounded service definitions
      (`name`, digest-pinned image, non-secret env, generated password env,
      connection env/URL placeholders, required healthcheck).
- [x] Agent Docker service runtime: per-run internal network, health wait,
      sandbox `/etc/hosts` entries, generated connection env via 0600 env-file,
      cleanup on failure/destroy/startup reaping.
- [x] Host mode fails closed for profiles with services.
- [x] Frontend `repoProfiles` API module, `RepoProfileEditor` component and
      Project Settings tab.
- [x] Tests for backend/agent validation, Docker service lifecycle, frontend
      API and editor save flow.

### Slice 1 — schema, detection, runtime, dry run

- [x] Migration `050_repo_profiles.sql` + rollback: profiles, validations,
      nullable `harness_runs` profile columns.
- [x] Backend `RepoProfileService`: versioned create/update/activate, active
      lookup, GitHub-manifest detection, agent read.
- [x] Backend `RepoProfileValidationService`: queued dry runs, atomic claim,
      finish, profile-budget stale reap.
- [x] Backend Joi schema + OpenAPI routes + project owner/super-admin boundary.
- [x] Agent `RepoProfile` model: re-validate schema, image digest, env secrets,
      commands, cache rejection and origin CA bundle.
- [x] Agent profile fetch + runtime use: base branch, setup/verify, timeouts,
      env, image, max-round deadline, run profile columns.
- [x] Agent `ProfileValidationProcessor`: clone → sandbox → setup → verify →
      report; no model session, no publish.
- [x] fg-34/D27 profile origin CA: only allowlisted exact hosts, terminate mode
      only, audited through the existing supervisor/proxy logs.
- [x] Tests for schema/API/detection/dry-run/runtime/repo-binding/activation/D27 paths.
- [x] Update `PENDING.txt`, `HARNESS_ROADMAP.md`, fg-34 D27 status.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/050_repo_profiles.sql` | add | Profile/validation tables and harness-run profile columns |
| `backend/src/migrations/050_repo_profiles_rollback.sql` | add | Drop new tables/columns |
| `backend/src/migrations/apply.js` | edit | Register `050` |
| `backend/src/validators/repoProfiles.js` | add | Profile schema, secret/env/host/CA validation |
| `backend/src/services/RepoProfileService.js` | add | Versioning, activation, detection, agent read |
| `backend/src/services/RepoProfileValidationService.js` | add | Dry-run queue/claim/finish/profile-budget stale reap |
| `backend/src/api/repoProfiles.js` | add | Project/agent routes, OpenAPI JSDoc |
| `backend/src/api/v1/index.js` | edit | Mount router before `/projects` |
| `backend/src/providers/github/api.js` | edit | Bounded repository file-content read |
| `backend/src/providers/github/index.js` | edit | Expose file-content read |
| `backend/src/services/GitHubService.js` | edit | Project-scoped manifest read helper |
| `backend/src/__tests__/repoProfileService.test.js` | add | Version/activation/validation/detection |
| `backend/src/__tests__/repoProfileValidationService.test.js` | add | Queue/claim/finish/stale/permission |
| `backend/src/__tests__/integration/repoProfiles.test.js` | add | Real-Postgres migration/service/dry-run/activation |
| `backend/src/__tests__/repoProfilesApi.test.js` | add | Route auth/contract/error paths |
| `agent/.../harness/RepoProfile.java` | add | Validated profile model + env mapping + cache rejection |
| `agent/.../harness/RepoProfileFetcher.java` | add | Agent profile fetch, fallback warning |
| `agent/.../harness/ProfileValidationProcessor.java` | add | Dry-run execution and reporting |
| `agent/.../service/ApiService.java` | edit | Profile/validation endpoints |
| `agent/.../service/WorkspaceManager.java` | edit | Base-branch checkout overload |
| `agent/.../harness/SandboxConfig.java` | edit | Profile image/env/CA derivation |
| `agent/.../harness/VerificationRunner.java` | edit | Host-mode profile env |
| `agent/.../harness/HarnessTicketProcessor.java` | edit | Fetch/use profile, run columns, PR base |
| `agent/.../AgentApp.java` | edit | Poll dry-run validation queue |
| `agent/src/test/java/.../RepoProfileTest.java` | add | Model validation/env/cache-rejection/CA |
| `agent/src/test/java/.../ProfileValidationProcessorTest.java` | add | Success/failure/cleanup/claim |
| `agent/src/test/java/.../SandboxConfigTest.java` | edit | Profile image/env/CA |
| `agent/src/test/java/.../WorkspaceManagerTest.java` | edit | Base branch + failure |
| `agent/src/test/java/.../HarnessTicketProcessorTest.java` | edit | Profile-driven run |
| `agent/.../harness/ServiceSpec.java` | add | Service container spec |
| `agent/.../harness/RepoProfile.java` | edit | Service schema + validation/toSpec |
| `agent/.../harness/SandboxConfig.java` | edit | Profile services -> spec; host fail |
| `agent/.../harness/DockerSandboxRunner.java` | edit | Service network/containers/health/cleanup |
| `agent/src/test/java/.../DockerSandboxRunnerTest.java` | edit | Healthy/unhealthy service lifecycle |
| `agent/src/test/java/.../SandboxConfigTest.java` | edit | Services require Docker |
| `frontend/src/api/repoProfiles.ts` | add | Hand-written profile API client/types |
| `frontend/src/components/RepoProfileEditor.vue` | add | Profile editor |
| `frontend/src/views/ProjectDetail.vue` | edit | Repository Profile tab |
| `frontend/src/__tests__/repoProfiles.test.ts` | add | API contract |
| `frontend/src/__tests__/repoProfileEditor.test.ts` | add | Editor load/save |
| `backend/src/__tests__/repoProfileService.test.js` | edit | Service schema validation |

## Dependencies

- fg-30 Phase 1, fg-34 (merged sandbox/egress/D27 runtime).
- fg-36 will consume `profile.base_branch`; slice 1 uses it locally.

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend | `repoProfileService.test.js`, `repoProfiles.test.js` | Create/update/activate versions; reject missing verify, secret env, unpinned image, unknown fields; require an active connected repo with a matching URL at every transition; activation requires a successful exact-content dry run | `cd backend && npx jest repoProfileService --runInBand`; integration test with real Postgres |
| FR1 | Agent | `RepoProfileTest.java` | Parse/validate v1 fields; reject unknown/invalid security fields | `cd agent && mvn -Dtest=RepoProfileTest test` |
| FR2 | Backend | `repoProfileService.test.js` | Detect Node/Python/Java/Go/monorepo manifests and propose commands | same |
| FR3 | Backend/Agent | `repoProfileService.test.js`, `SandboxConfigTest.java` | Image override only with `@sha256`; profile image reaches `SandboxSpec` | both |
| FR4 | Backend/Agent | `repoProfileService.test.js`, `RepoProfileTest.java` | Non-empty caches are rejected until D9/fg-44 (no unbounded volume); cache quota/GC is deferred | both |
| FR5 | Backend/Agent/Frontend | `repoProfileService.test.js`, `RepoProfileTest.java`, `SandboxConfigTest.java`, `DockerSandboxRunnerTest.java`, `RepoProfileEditor.vue` | Service schema validation; Docker lifecycle with health wait, generated credentials, internal network and cleanup; host mode fails closed; editor can edit/save services | backend/agent/frontend suites |
| FR6 | Agent | `HarnessTicketProcessorTest.java`, `ProfileValidationProcessorTest.java`, `WorkspaceManagerTest.java` | Model session and setup/verify share the `max_round_minutes` cap; clone has a bounded timeout; failure stops publish | `cd agent && mvn -Dtest=HarnessTicketProcessorTest,ProfileValidationProcessorTest,WorkspaceManagerTest test` |
| FR7 | Backend/Agent | `repoProfileService.test.js`, `RepoProfileTest.java` | Non-secret env accepted; secret-like key/value rejected | both |
| FR8 | Backend | `repoProfileService.test.js` | Non-empty `flaky_tests` is rejected until slice 3 (never silently ignored) | `cd backend && npx jest repoProfileService --runInBand` |
| FR9 | Backend/Agent | `repoProfileValidationService.test.js`, `ProfileValidationProcessorTest.java` | Queue/claim/finish; success/failure result; profile-budget stale reap (>60-minute regression); activation requires the successful exact `profile_hash`; dry runs run after ticket work | both |
| FR10 | Agent | `HarnessTicketProcessorTest.java` | Missing/failed profile fetch warns and keeps autodetection; a profile for another repo is rejected before run start | `cd agent && mvn -Dtest=HarnessTicketProcessorTest test` |
| D27 | Backend/Agent | `repoProfileService.test.js`, `SandboxConfigTest.java` | CA bundle shape validated; host must be allowlisted; `sni-only` mismatch fails closed | both |
| FR2/FR5 (UI) | Frontend | `repoProfiles.test.ts`, `repoProfileEditor.test.ts` | Detect/save/validate/activate API contract; draft editor loads and saves profile fields | `cd frontend && npx vitest run src/__tests__/repoProfiles.test.ts src/__tests__/repoProfileEditor.test.ts` |
| D29 | Backend/Agent | `repoProfileMtlsService.test.js`, `RepoProfileTest.java`, `SandboxConfigTest.java`, `EgressProxyScriptTest.java`, `EgressProxyTerminateIntegrationTest.java` | mTLS credential cert/key match, encrypted key, scoped hosts; profile reference validation; proxy presents the client cert only to the exact host and audits use | both |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-16 | `5af3d48` | Backend 137 suites / 1707 tests; agent 678 tests / 9 skipped | Pass. `node planning/check-planning.js`, backend lint (0 errors), `git diff --check`, root and agent Compose configs pass. Slice 1 covers FR1-FR3, FR6, FR7, FR9, FR10 and the D27 profile handoff; FR4/FR5/FR8 fail closed until their slices. |
| 2026-11-16 | `cdb6d13` | Backend 137 suites / 1717 tests; agent 683 tests / 9 skipped; real-Postgres integration 4 tests | Final review cleanup: `max_round_minutes` is passed to the OpenCode client so the model session is bounded; dry-run clone/sandbox setup share the overall deadline and clone has an explicit timeout; harness-run profile evidence requires an active profile with a matching successful validation; migration 050 adds idempotent `profile_hash` columns; cache documentation drift removed. |
| 2026-11-16 | `32ce869` | Backend 137 suites / 1719 tests; agent 683 tests / 9 skipped; integration 6 tests | Upgrade-safe migration: `profile_hash` ALTERs run before the index that references them; a real-Postgres test creates the earlier draft schema and applies 050. Legacy null profile hashes are persisted when queuing validation or activating, so existing profiles can be validated and activated. Runtime clone timeout now follows the profile setup budget. |
| 2026-11-16 | `97fcc99` | Backend 137 suites / 1721 tests | Closed the legacy-hash race: the validation request only backfills `profile_hash` when it is still null, re-reads on a lost update and fails with a conflict if the profile changed. Activation also backfills an already-active legacy row. Added unit regressions for both paths. |
| 2026-11-17 | `feat/fg-39-slice2-services` | Backend 145 suites / 1830 tests; agent 748 tests / 10 skipped; frontend 63 files / 575 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass. Slice 2 adds bounded service definitions, a per-run internal network, Docker health checks, generated per-run passwords through 0600 env-files, sandbox `/etc/hosts` entries, egress attach after creation, and cleanup on failure/destroy. Host mode fails closed for services. Slice 5 adds the Repository Profile tab and editor with detection, drafts, dry-run polling, activation, version history and read-only gating. Verified with backend lint (0 errors), backend unit/integration, agent `mvn test`, frontend lint/typecheck/tests, `SANDBOX_IT_IMAGE=vibecode-agent-sandbox:latest SANDBOX_IT_SERVICE_IMAGE=pgvector/pgvector@sha256:7d0a… mvn test -Dtest=DockerSandboxRunnerIntegrationTest#reachesAProfileServiceContainer`, `node planning/check-planning.js`, `git diff --check`, and root/test/override Compose configs. |
