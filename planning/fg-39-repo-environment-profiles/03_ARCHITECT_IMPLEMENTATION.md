# 03 — Implementation (fg-39)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

### Slice 1 — schema, detection, runtime, dry run

- [ ] Migration `050_repo_profiles.sql` + rollback: profiles, validations,
      nullable `harness_runs` profile columns.
- [ ] Backend `RepoProfileService`: versioned create/update/activate, active
      lookup, GitHub-manifest detection, agent read.
- [ ] Backend `RepoProfileValidationService`: queued dry runs, atomic claim,
      finish, 60-minute stale reap.
- [ ] Backend Joi schema + OpenAPI routes + project owner/super-admin boundary.
- [ ] Agent `RepoProfile` model: re-validate schema, image digest, env secrets,
      commands, cache names and origin CA bundle.
- [ ] Agent profile fetch + runtime use: base branch, setup/verify, timeouts,
      env, image, cache volume, run profile columns.
- [ ] Agent `ProfileValidationProcessor`: clone → sandbox → setup → verify →
      report; no model session, no publish.
- [ ] fg-34/D27 profile origin CA: only allowlisted exact hosts, terminate mode
      only, audited through the existing supervisor/proxy logs.
- [ ] Tests for schema/API/detection/dry-run/runtime/cache/D27 paths.
- [ ] Update `PENDING.txt`, `HARNESS_ROADMAP.md`, fg-34 D27 status.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/050_repo_profiles.sql` | add | Profile/validation tables and harness-run profile columns |
| `backend/src/migrations/050_repo_profiles_rollback.sql` | add | Drop new tables/columns |
| `backend/src/migrations/apply.js` | edit | Register `050` |
| `backend/src/validators/repoProfiles.js` | add | Profile schema, secret/env/host/CA validation |
| `backend/src/services/RepoProfileService.js` | add | Versioning, activation, detection, agent read |
| `backend/src/services/RepoProfileValidationService.js` | add | Dry-run queue/claim/finish/stale reap |
| `backend/src/api/repoProfiles.js` | add | Project/agent routes, OpenAPI JSDoc |
| `backend/src/api/v1/index.js` | edit | Mount router before `/projects` |
| `backend/src/providers/github/api.js` | edit | Bounded repository file-content read |
| `backend/src/providers/github/index.js` | edit | Expose file-content read |
| `backend/src/services/GitHubService.js` | edit | Project-scoped manifest read helper |
| `backend/src/__tests__/repoProfileService.test.js` | add | Version/activation/validation/detection |
| `backend/src/__tests__/repoProfileValidationService.test.js` | add | Queue/claim/finish/stale/permission |
| `backend/src/__tests__/repoProfilesApi.test.js` | add | Route auth/contract/error paths |
| `agent/.../harness/RepoProfile.java` | add | Validated profile model + env/cache mapping |
| `agent/.../harness/RepoProfileFetcher.java` | add | Agent profile fetch, fallback warning |
| `agent/.../harness/ProfileValidationProcessor.java` | add | Dry-run execution and reporting |
| `agent/.../service/ApiService.java` | edit | Profile/validation endpoints |
| `agent/.../service/WorkspaceManager.java` | edit | Base-branch checkout overload |
| `agent/.../harness/SandboxConfig.java` | edit | Profile image/env/cache/CA derivation |
| `agent/.../harness/SandboxSpec.java` | edit | Cache volume field |
| `agent/.../harness/DockerSandboxRunner.java` | edit | Cache mount/init, profile spec |
| `agent/.../harness/VerificationRunner.java` | edit | Host-mode profile env |
| `agent/.../harness/HarnessTicketProcessor.java` | edit | Fetch/use profile, run columns, PR base |
| `agent/.../AgentApp.java` | edit | Poll dry-run validation queue |
| `agent/src/test/java/.../RepoProfileTest.java` | add | Model validation/env/cache/CA |
| `agent/src/test/java/.../ProfileValidationProcessorTest.java` | add | Success/failure/cleanup/claim |
| `agent/src/test/java/.../SandboxConfigTest.java` | edit | Profile image/env/cache/CA |
| `agent/src/test/java/.../DockerSandboxRunnerTest.java` | edit | Cache mount/init |
| `agent/src/test/java/.../WorkspaceManagerTest.java` | edit | Base branch + failure |
| `agent/src/test/java/.../HarnessTicketProcessorTest.java` | edit | Profile-driven run |

## Dependencies

- fg-30 Phase 1, fg-34 (merged sandbox/egress/D27 runtime).
- fg-36 will consume `profile.base_branch`; slice 1 uses it locally.

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend | `repoProfileService.test.js` | Create/update/activate versions; reject missing verify, secret env, unpinned image, unknown fields | `cd backend && npx jest repoProfileService --runInBand` |
| FR1 | Agent | `RepoProfileTest.java` | Parse/validate v1 fields; reject unknown/invalid security fields | `cd agent && mvn -Dtest=RepoProfileTest test` |
| FR2 | Backend | `repoProfileService.test.js` | Detect Node/Python/Java/Go/monorepo manifests and propose commands | same |
| FR3 | Backend/Agent | `repoProfileService.test.js`, `SandboxConfigTest.java` | Image override only with `@sha256`; profile image reaches `SandboxSpec` | both |
| FR4 | Agent | `SandboxConfigTest.java`, `DockerSandboxRunnerTest.java` | Cache volume name/env and mount/init for declared caches; no cross-project name | `cd agent && mvn -Dtest=SandboxConfigTest,DockerSandboxRunnerTest test` |
| FR5 | Backend | `repoProfileService.test.js` | Non-empty `services` is rejected until slice 2 (fail closed) | `cd backend && npx jest repoProfileService --runInBand` |
| FR6 | Agent | `HarnessTicketProcessorTest.java`, `ProfileValidationProcessorTest.java` | Setup then verify; per-command timeout budget; failure stops publish | `cd agent && mvn -Dtest=HarnessTicketProcessorTest,ProfileValidationProcessorTest test` |
| FR7 | Backend/Agent | `repoProfileService.test.js`, `RepoProfileTest.java` | Non-secret env accepted; secret-like key/value rejected | both |
| FR8 | Backend | `repoProfileService.test.js` | Non-empty `flaky_tests` is rejected until slice 3 (never silently ignored) | `cd backend && npx jest repoProfileService --runInBand` |
| FR9 | Backend/Agent | `repoProfileValidationService.test.js`, `ProfileValidationProcessorTest.java` | Queue/claim/finish; success/failure result; stale reap | both |
| FR10 | Agent | `HarnessTicketProcessorTest.java` | Missing/failed profile fetch warns and keeps autodetection | `cd agent && mvn -Dtest=HarnessTicketProcessorTest test` |
| D27 | Backend/Agent | `repoProfileService.test.js`, `SandboxConfigTest.java` | CA bundle shape validated; host must be allowlisted; `sni-only` mismatch fails closed | both |

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
| | | | |
