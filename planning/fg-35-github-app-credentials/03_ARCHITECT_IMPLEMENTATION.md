# 03 — Implementation (fg-35)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Create/register the GitHub App and define required permissions (documented in `05_RUNBOOK.md`)
- [x] Define installation-per-project mapping and repo allowlist
- [x] Implement token minting, caching and expiry handling
- [x] Use the token without persisting it in the workspace or process args
- [x] Add rotation/revocation and audit events
- [x] Add a dev-only PAT fallback behind a flag
- [x] Add tests for expiry, scope, leakage and multi-repo isolation
- [x] Document GitHub Enterprise support and migration from PATs

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/049_project_github_installations.sql` | CREATE | `project_id` → installation id, repo allowlist, `disabled_at`, timestamps. |
| `backend/src/migrations/049_project_github_installations_rollback.sql` | CREATE | Drops the mapping table. |
| `backend/src/migrations/apply.js` | MODIFY | Register migration 049. |
| `backend/src/services/GitHubAppAuthService.js` | CREATE | App JWT, installation-token mint/cache, repo scope/allowlist, PAT fallback, audit, disable/revoke. |
| `backend/src/services/GitHubService.js` | MODIFY | App mode never returns the stored PAT; backend branch/PR/diff operations use a minted token. |
| `backend/src/controllers/githubController.js` | MODIFY | Token request plus installation status/upsert/disable handlers. |
| `backend/src/api/github.js` | MODIFY | Token and installation routes with agent/owner guards. |
| `backend/src/validators/github.js` | MODIFY | Installation and token-request schemas. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubTokenSource.java` | CREATE | Token supplier contract with optional invalidation. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubTokenProvider.java` | CREATE | Per-run token fetch, expiry-aware refresh, in-memory cache and known-token set. |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | `requestGitHubToken(projectId)`. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` | MODIFY | Use a token source; fail closed when no credential is available. |
| `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java` | MODIFY | Askpass uses the current token source; all observed tokens are redacted. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | MODIFY | Workspace factory uses the token source. |
| `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` | MODIFY | Legacy path accepts a token source. |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | MODIFY | Build the provider, fail closed in app mode, keep explicit PAT fallback. |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | MODIFY | `GITHUB_AUTH_MODE`/`ALLOW_PAT` parsing and validation. |
| `backend/src/__tests__/githubAppAuthService.test.js` | CREATE | Mint/cache/scope/allowlist/disable/PAT/fail-closed/audit coverage. |
| `backend/src/__tests__/githubAppController.test.js` | CREATE | Owner/super-admin authorization and installation handlers. |
| `backend/src/__tests__/githubAppAuthWiring.test.js` | CREATE | Route ordering/guards and migration registration. |
| `backend/src/__tests__/githubService.test.js` | MODIFY | App-mode repo config and minted-token PR path. |
| `agent/src/test/java/com/vibecode/agent/service/GitHubTokenProviderTest.java` | CREATE | Cache, refresh, invalidation, expiry parsing and fail-closed fetch. |
| `agent/src/test/java/com/vibecode/agent/service/GitHubServiceTest.java` | MODIFY | Latest-token supplier and missing-credential failure. |
| `agent/src/test/java/com/vibecode/agent/config/AgentConfigTest.java` | MODIFY | Auth-mode/flag parsing. |
| `agent/src/test/java/com/vibecode/agent/service/WorkspaceManagerTest.java` | MODIFY | Askpass uses the current token-source value and removes the temp dir. |
| `agent/src/test/java/com/vibecode/agent/harness/SecretRedactorTest.java`; `SecretLeakGuardTest.java` | MODIFY | `ghs_` token coverage. |
| `planning/fg-35-github-app-credentials/05_RUNBOOK.md` | CREATE | App registration, installation mapping, rotation/revocation, PAT fallback, migration and rollback. |

## Dependencies

- fg-30 (merged).

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Docs | `05_RUNBOOK.md`; `githubAppAuthWiring.test.js` | `documents the minimum GitHub App permissions and no admin scope` | `cd backend && npx jest src/__tests__/githubAppAuthWiring.test.js --runInBand` |
| FR2 | Backend | `githubAppAuthService.test.js` | `upserts an installation mapping and normalizes the allowlist`; `requires an installation mapping unless the single-tenant env fallback is set` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR3 | Backend | `githubAppAuthService.test.js` | `mints a repo-scoped installation token with the minimum permissions`; `reuses the cached token until shortly before expiry`; `caps the client-side lifetime at GITHUB_TOKEN_TTL_SECONDS` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR4 | Agent | `GitHubTokenProviderTest.java`; `githubAppController.test.js` | `cachesUntilShortlyBeforeExpiryThenRefreshes`; `returns a scoped token to the project owner agent` | `cd agent && mvn -Dtest=GitHubTokenProviderTest test`; `cd backend && npx jest src/__tests__/githubAppController.test.js --runInBand` |
| FR5 | Agent | `WorkspaceManagerTest.java`; `GitHubServiceTest.java` | `cloneUsesTheCurrentTokenFromTheSourceAndRemovesAskpass`; `usesTheLatestTokenFromTheSource`; `stripCredentialsRemovesGitHubToken` | `cd agent && mvn -Dtest=WorkspaceManagerTest,GitHubServiceTest test` |
| FR6 | Backend/Agent | `githubService.test.js`; `GitHubServiceTest.java` | `uses a minted installation token for backend PR operations`; `usesTheLatestTokenFromTheSource` | `cd backend && npx jest src/__tests__/githubService.test.js --runInBand`; `cd agent && mvn -Dtest=GitHubServiceTest test` |
| FR7 | Backend | `githubAppAuthService.test.js` | `disables access and revokes the cached installation token`; `keeps the project disabled even when revocation fails`; `reports when no cached token can be revoked` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR8 | Backend | `githubAppAuthService.test.js` | `mints a repo-scoped installation token with the minimum permissions` asserts the audit payload and no token | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR9 | Backend/Agent | `githubAppAuthService.test.js`; `AgentConfigTest.java` | `requires ALLOW_PAT before returning a stored PAT`; `returns the stored PAT only when explicitly allowed`; `testGitHubAuthModeIsExplicitAndValid` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand`; `cd agent && mvn -Dtest=AgentConfigTest test` |
| FR10 | Backend/Agent | `githubAppAuthService.test.js`; `GitHubTokenProviderTest.java` | `rejects a project whose installation is disabled`; `fails closed when App credentials are missing`; `maps a network failure to a fail-closed mint error`; `failsClosedWhenTheBackendReturnsNoToken` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand`; `cd agent && mvn -Dtest=GitHubTokenProviderTest test` |
| NFR1 | Backend/Agent | `githubAppAuthService.test.js`; `GitHubTokenProviderTest.java`; `WorkspaceManagerTest.java` | Audit payload excludes the token; provider holds tokens in memory only; stale askpass directories are removed | commands above |
| NFR2 | Backend | `githubAppAuthService.test.js` | Disabled, missing config, rejected mint, network failure and scope mismatch fail closed | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| NFR3 | All | This matrix | Fake GitHub/backend; no live API | `cd backend && npm test`; `cd agent && mvn test` |
| NFR4 | Docs | `05_RUNBOOK.md` | Registration, mapping, rotation, revocation, fallback, rollback | `node planning/check-planning.js` |

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | author | none | Implementation plan and verification matrix | n/a |
| 1 | independent reviewer | B1 numeric/string owner comparison rejected real owners; B2 revocation called a nonexistent GitHub endpoint; B3 `/repo/agent` returned PATs to any agent key; B4 the PAT/env fallback was fetched but not wired into the credential source; B5 PAT mode ignored `disabled_at`. | Fixed string-safe ownership checks and tests; revocation now uses `DELETE /installation/token` with the cached token and reports `revoked`/`cachedTokens`; `/repo/agent` applies the owner check; the token provider takes an explicit PAT fallback source; PAT mode and backend operations honor `disabled_at`. | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-14 | `feat/fg-35-github-app-credentials` | `cd backend && npm test` (131 suites, 1622 tests) + `cd agent && mvn test` (531 tests, 5 skipped) + `node planning/check-planning.js` + `git diff --check` | Pass. Backend mints/caches/revokes installation tokens, exposes the token and mapping routes, and fails closed; App mode no longer returns the stored PAT. The agent refreshes the token through a provider and git/PR calls consume it from a token source. PAT fallback is explicit and wired through the provider. Review round 1 findings B1-B5 are resolved with regression tests. |
