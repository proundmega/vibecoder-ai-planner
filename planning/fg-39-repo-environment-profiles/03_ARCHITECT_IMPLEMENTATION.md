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

### Slice 3 — flaky tests and test data

- [x] Backend/agent schema: `flaky_tests`, `flaky_retries` (0–2) and
      `test_data.setup`/`cleanup`; commands and secrets are validated.
- [x] Verification retries only when the failed output names a known-flaky
      test, records `attempts`/`flaky` and still fails a consistent failure.
- [x] Harness and profile validation run test-data setup before verification
      and cleanup after it; cleanup failure fails closed before publish.
- [x] Profile editor fields round-trip the flaky policy and test-data hooks.

Flaky matching is a plain, case-sensitive substring against the captured
(truncated) verification output. Entries should be test files or unique test
names, not generic words; a broad entry can over-retry, and a failure whose
output does not include the entry is not retried. A consistent failure still
fails the run.

Files: `backend/src/validators/repoProfiles.js`,
`backend/src/services/RepoProfileService.js`,
`agent/.../harness/RepoProfile.java`, `VerificationRunner.java`,
`VerificationResult.java`, `HarnessTicketProcessor.java`,
`ProfileValidationProcessor.java`,
`frontend/src/components/RepoProfileEditor.vue`, plus tests.

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
| FR3 | Backend/Agent | `stackImages.test.js`, `repoProfileService.test.js`, `SandboxConfigTest.java` | Catalog parses digest-pinned per-stack images, rejects unknown/unpinned entries and selects monorepo for multi-language repos; detection proposes the configured image and warns when absent; every stack Dockerfile base is digest-pinned; the profile image reaches `SandboxSpec` | `cd backend && npx jest stackImages repoProfileService --runInBand`; `bash agent/scripts/build-sandbox-images.sh --check-pins` |
| FR4 | Backend/Agent | `repoProfileService.test.js`, `RepoProfileTest.java` | Non-empty caches are rejected until D9/fg-44 (no unbounded volume); cache quota/GC is deferred | both |
| FR5 | Backend/Agent/Frontend | `repoProfileService.test.js`, `repoProfileValidationService.test.js`, `RepoProfileTest.java`, `SandboxConfigTest.java`, `DockerSandboxRunnerTest.java`, `ProfileValidationProcessorTest.java`, `RepoProfileEditor.vue` | Service schema validation including PASS/PWD keys, literal userinfo/query/path credentials (including generated-password-shaped 32+ hex values in query/path/fragment), short client password flags (`mysql/mariadb -p`, `redis-cli -a`, `REDISCLI_AUTH`), healthcheck/command credentials, encoded placeholders, newlines/NUL and reserved env names; legacy rows are scrubbed at read time for members/read-only views while the owner's current draft and write responses stay raw; Docker lifecycle with health wait, generated credentials, internal network, tracked-name cleanup, fail-closed removal, log bounds and `NET_RAW` drop; generated passwords registered for redaction; dry-run results redacted at the agent and backend and hidden from members; dry-run destroy failures are reported as failed; host mode fails closed; editor can edit/save services | backend/agent/frontend suites |
| FR6 | Agent | `HarnessTicketProcessorTest.java`, `ProfileValidationProcessorTest.java`, `WorkspaceManagerTest.java` | Model session and setup/verify share the `max_round_minutes` cap; clone has a bounded timeout; failure stops publish | `cd agent && mvn -Dtest=HarnessTicketProcessorTest,ProfileValidationProcessorTest,WorkspaceManagerTest test` |
| FR7 | Backend/Agent | `repoProfileService.test.js`, `RepoProfileTest.java` | Non-secret env accepted; secret-like key/value rejected | both |
| FR8 | Backend/Agent/Frontend | `repoProfileFlaky.test.js`, `RepoProfileTest.java`, `VerificationRunnerTest.java`, `HarnessTicketProcessorTest.java`, `ProfileValidationProcessorTest.java`, `WorkspaceManagerTest.java`, `repoProfileEditor.test.ts` | Schema accepts `flaky_tests`/`flaky_retries`/`test_data`; retries only when failed output names a flaky test; a consistent failure still fails; test-data cleanup runs on setup failure/cleanup-only and fails closed on command failure or content/tree changes; attempts/flaky are recorded; the editor round-trips the fields | backend Jest, targeted `mvn -Dtest=...`, `vitest run src/__tests__/repoProfileEditor.test.ts` |
| FR9 | Backend/Agent | `repoProfileValidationService.test.js`, `ProfileValidationProcessorTest.java` | Queue/claim/finish; success/failure result; profile-budget stale reap (>60-minute regression); activation requires the successful exact `profile_hash`; dry runs run after ticket work | both |
| FR10 | Agent | `HarnessTicketProcessorTest.java` | Missing/failed profile fetch warns and keeps autodetection; a profile for another repo is rejected before run start | `cd agent && mvn -Dtest=HarnessTicketProcessorTest test` |
| D27 | Backend/Agent | `repoProfileService.test.js`, `SandboxConfigTest.java` | CA bundle shape validated; host must be allowlisted; `sni-only` mismatch fails closed | both |
| FR2/FR5 (UI) | Frontend | `repoProfiles.test.ts`, `repoProfileEditor.test.ts` | Detect/save/validate/activate API contract; draft editor loads and saves profile and service fields; historical versions are read-only; detect over an active profile can create a draft and confirms when only non-service fields were edited; validation polling; non-owner gating; dry-run history cap is documented | `cd frontend && npx vitest run src/__tests__/repoProfiles.test.ts src/__tests__/repoProfileEditor.test.ts` |
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
| 2026-11-17 | `f629a5f` (#167) | Backend 145 suites / 1830 tests; agent 749 tests / 10 skipped; frontend 63 files / 576 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass. Slice 2 adds bounded service definitions, a per-run internal network, Docker health checks, generated per-run passwords through 0600 env-files, sandbox `/etc/hosts` entries, egress attach after creation, and cleanup on failure/destroy. Host mode fails closed for services. Slice 5 adds the Repository Profile tab and editor with detection, drafts, dry-run polling, activation, version history and read-only gating. Verified with backend lint (0 errors), backend unit/integration, agent `mvn test`, frontend lint/typecheck/tests, `SANDBOX_IT_IMAGE=vibecode-agent-sandbox:latest SANDBOX_IT_SERVICE_IMAGE=pgvector/pgvector@sha256:7d0a… mvn test -Dtest=DockerSandboxRunnerIntegrationTest#reachesAProfileServiceContainer`, `node planning/check-planning.js`, `git diff --check`, and root/test/override Compose configs. |
| 2026-11-17 | review fixes | Backend 145 suites / 1835 tests; agent 754 tests / 10 skipped; frontend 63 files / 582 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass. Shared secret validation now rejects `PASS`/`PWD` keys (`DB_PASS`, `DB_PWD`, `PGPASS`, `DBPASS`), literal userinfo/query/path credentials (even when `${password}` appears elsewhere), credential-shaped healthcheck/command arguments, newlines/NUL and reserved env names. Generated service passwords are registered in `RedactionRegistry`; the agent redacts command/output, the backend re-redacts result/error at ingest, and dry-run output is limited to the project owner or a super admin. Service containers are tracked before `docker run`, cleanup failures keep the runtime tracked and make `destroy()` fail closed, logs are bounded and `NET_RAW` is dropped. The editor only edits the current draft, historical views are read-only, and Save/Validate/Activate target that draft. The real-Docker smoke test now reads `DATABASE_URL`, checks the service host/port/user, and compares the generated password hash with the service container. |
| 2026-11-17 | second review fixes | Backend 146 suites / 1841 tests; agent 756 tests / 10 skipped; frontend 63 files / 583 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass. Short client password flags (`mysql/mariadb -p`, `redis-cli -a`, `REDISCLI_AUTH`), 32+ hex query/path/fragment credentials and percent-encoded placeholders are rejected; reserved env names now apply to profile and service env. Dry runs destroy the sandbox before reporting success, so a cleanup failure reports `failed` and cannot be activated. `close()` retries tracked service cleanup after a failed destroy. Legacy profile/validation reads are redacted (URL userinfo, key/value credentials, short flags, 64-hex values) without mutating stored rows or image digests. Detection confirms when only non-service fields were edited, and the 200-row dry-run history cap is documented. |
| 2026-11-17 | third review fixes | Backend 146 suites / 1844 tests; agent 758 tests / 10 skipped; frontend 63 files / 583 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass. Read-time scrubbing is owner-aware: the editable current draft and owner write responses stay raw, so `[REDACTED]` can never be saved over a profile; members/read-only views receive scrubbed profiles. Short client password validation/redaction is case-sensitive (`mysql -P 3306` and `mysql -p -h host` stay valid), covers `mysqladmin`/`mysqldump`, and handles `REDISCLI_AUTH` and short `DB_PASS`/`PGPASS`/`DBPASS`/`PASS` values. The backend/agent redactors share the same key rules, and 64-hex `sha256:` digests are preserved. |
| 2026-11-17 | fourth review fixes | Backend 146 suites / 1844 tests; agent 758 tests / 10 skipped; frontend 63 files / 583 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass. Client names are matched case-insensitively in both backend and agent while the password flag remains case-sensitive (`MYSQL -P 3306` is a port, `MYSQL -psecret` is a password). `AUTH`/`AUTHORIZATION` are part of the shared secret-key rule and are rejected in profile/service env and scrubbed on read. Quoted `$ENV` references such as `mysql -p "$MYSQL_PWD"` are preserved by the agent log redactor; literal quoted values are still redacted. |
| 2026-11-17 | rebased onto `f6e9464` (#166) | Backend 147 suites / 1874 tests; agent 804 tests / 10 skipped; frontend 64 files / 587 tests; real-Postgres integration 8 tests; real-Docker service smoke test | Pass after rebasing onto fg-42. `AUTH_MODE`/`AUTH_TYPE`-style keys are no longer treated as credentials; exact `AUTH`/`AUTHORIZATION`/`BASIC_AUTH` remain covered. The secret-redactor merge with fg-42 keeps high-entropy detection plus the repo-profile short-flag/key rules. |
| 2026-11-22 | `867b9f7` (#167) | fg-39 slices 2/5 | Merged; FR3 (D7), FR4 (D9) and FR8 (D6) remain open, so the suite stays `in_progress`. |
| 2026-11-24 | `83baf48` (PR #225) | Backend 162 suites / 1875 tests; agent 1007 tests / 10 skipped; frontend 70 files / 600 tests + typecheck/lint | Slice 3: `flaky_tests`/`flaky_retries`/`test_data` schema and agent validation; retries only when failed output names a known-flaky test and records attempts/flaky; test-data setup/cleanup phases with fail-closed cleanup (including setup failure/cleanup-only and a temporary-index tree fingerprint so cleanup cannot publish a tree that differs from the verified one; the test covers already-dirty files, untracked non-ignored files, ignored test data and assume-unchanged flags); editor round-trip. |
| 2026-11-24 | `e2b94f1` (PR #225, merged) | Slice 3 merged | FR8/D6 done. The suite stays `in_progress` for FR3 (slice 4a) and FR4 (slice 4b). |
| 2026-11-24 | `272a5e3` (PR #232) | Backend 165 suites / 1943 tests; backend integration 22 suites / 174 tests; agent 1007 tests / 0 failures / 10 skipped; Node stack stage built; pin check clean | Slice 4a: digest-pinned Node/Python/Java/Go/monorepo stages with common toolchains and a build helper; catalog rejects unknown/unpinned mappings; detection proposes the configured stack image (monorepo for multi-language repos) and warns when absent; `REPO_PROFILE_STACK_IMAGES` wired through Compose. FR3/D7 in review; FR4/D9 remains. |
