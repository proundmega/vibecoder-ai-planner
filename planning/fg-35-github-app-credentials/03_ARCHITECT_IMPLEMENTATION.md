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
| `docker-compose.yml`; `docker-compose.override.yml`; `backend/.env.example` | MODIFY | Forward App variables to the API; local Compose defaults to the PAT fallback; document env values and the key-file mount. |
| `backend/src/services/PoolManager.js` | MODIFY | Own pool agents by the project owner and pass `GITHUB_AUTH_MODE`/`ALLOW_PAT`. |
| `backend/src/services/GitHubAppAuthService.js` | CREATE | App JWT, installation-token mint/cache, repo scope/allowlist, PAT fallback, audit, disable/revoke. |
| `backend/src/services/GitHubService.js` | MODIFY | App mode never returns the stored PAT; backend branch/PR/diff operations use a minted token and retry once on a 401. |
| `backend/src/controllers/githubController.js` | MODIFY | Token request plus installation status/upsert/disable handlers; owner checks; body-less branch/PR project resolution. |
| `backend/src/api/github.js` | MODIFY | Token and installation routes with agent/owner guards. |
| `backend/src/validators/github.js` | MODIFY | Installation and token-request schemas. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubTokenSource.java` | CREATE | Token supplier contract with optional invalidation. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubTokenProvider.java` | CREATE | Per-run token fetch, expiry-aware refresh, in-memory cache and known-token set. |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | `requestGitHubToken(projectId, forceRefresh)` and a typed rejection. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubTokenRequestException.java` | CREATE | Distinguishes a definitive backend rejection from a transport failure. |
| `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` | MODIFY | Use a token source; 401 refresh/retry; fail closed when no credential is available. |
| `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java` | MODIFY | Askpass uses the current token source; clone/push refresh and retry once on auth failure; all observed tokens are redacted. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | MODIFY | Workspace factory uses the token source. |
| `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` | MODIFY | Legacy path accepts a token source. |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | MODIFY | Build the provider, fail closed in app mode, keep explicit PAT fallback. |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | MODIFY | `GITHUB_AUTH_MODE`/`ALLOW_PAT` parsing and validation. |
| `backend/src/__tests__/githubAppAuthService.test.js` | CREATE | Mint/cache/scope/allowlist/disable/PAT/fail-closed/audit coverage. |
| `backend/src/__tests__/githubAppController.test.js` | CREATE | Owner/super-admin authorization, installation handlers and body-less branch/PR resolution. |
| `backend/src/__tests__/githubAppAuthWiring.test.js` | CREATE | Route ordering/guards and migration registration. |
| `backend/src/__tests__/githubAppDeploymentWiring.test.js` | CREATE | Compose/env/PoolManager wiring and runbook mount/revocation. |
| `backend/src/__tests__/githubService.test.js` | MODIFY | App-mode repo config and minted-token PR path. |
| `agent/src/test/java/com/vibecode/agent/service/GitHubTokenProviderTest.java` | CREATE | Cache, refresh, invalidation, expiry parsing and fail-closed fetch. |
| `agent/src/test/java/com/vibecode/agent/service/GitHubServiceTest.java` | MODIFY | Latest-token supplier and missing-credential failure. |
| `agent/src/test/java/com/vibecode/agent/config/AgentConfigTest.java` | MODIFY | Auth-mode/flag parsing. |
| `agent/src/test/java/com/vibecode/agent/service/WorkspaceManagerTest.java` | MODIFY | Askpass uses the current token-source value and removes the temp dir; clone/push auth retries, partial-clone cleanup and narrow auth matching. |
| `agent/src/test/java/com/vibecode/agent/AgentAppWiringTest.java` | CREATE | Static guard that `AgentApp` passes the provider object, not `::get`. |
| `agent/src/test/java/com/vibecode/agent/harness/SecretRedactorTest.java`; `SecretLeakGuardTest.java` | MODIFY | `ghs_` token coverage. |
| `planning/fg-35-github-app-credentials/05_RUNBOOK.md` | CREATE | App registration, installation mapping, rotation/revocation, PAT fallback, migration and rollback. |

## Dependencies

- fg-30 (merged).

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Docs | `05_RUNBOOK.md`; `githubAppAuthWiring.test.js` | `documents the minimum GitHub App permissions and no admin scope` | `cd backend && npx jest src/__tests__/githubAppAuthWiring.test.js --runInBand` |
| FR2 | Backend | `githubAppAuthService.test.js` | `upserts an installation mapping and normalizes the allowlist`; `requires an installation mapping unless the single-tenant env fallback is set` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR3 | Backend | `githubAppAuthService.test.js` | `mints a repo-scoped installation token with the minimum permissions`; `rejects a token minted for a different repository`; `rejects a token response without a repositories list`; `rejects a bare-name allowlist collision across installations`; `reuses the cached token until shortly before expiry`; `caps the client-side lifetime at GITHUB_TOKEN_TTL_SECONDS` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR4 | Agent | `GitHubTokenProviderTest.java`; `GitHubServiceTest.java`; `githubAppController.test.js` | `cachesUntilShortlyBeforeExpiryThenRefreshes`; `refreshesAndRetriesOnceAfterA401`; `refreshesAndRetriesOnceWhenPullRequestCreationReturns401`; `cloneDoesNotRefreshOnANonAuthenticationFailure`; `authenticationFailureMatchingIsNarrow`; `passesTheTokenProviderObjectToClients`; `returns a scoped token to the project owner agent` | `cd agent && mvn -Dtest=GitHubTokenProviderTest test`; `cd backend && npx jest src/__tests__/githubAppController.test.js --runInBand` |
| FR5 | Agent | `WorkspaceManagerTest.java`; `GitHubServiceTest.java` | `cloneUsesTheCurrentTokenFromTheSourceAndRemovesAskpass`; `usesTheLatestTokenFromTheSource`; `stripCredentialsRemovesGitHubToken` | `cd agent && mvn -Dtest=WorkspaceManagerTest,GitHubServiceTest test` |
| FR6 | Backend/Agent | `githubService.test.js`; `GitHubServiceTest.java` | `uses a minted installation token for backend PR operations`; `retries a backend GitHub 401 once with a fresh installation token`; `usesTheLatestTokenFromTheSource` | `cd backend && npx jest src/__tests__/githubService.test.js --runInBand`; `cd agent && mvn -Dtest=GitHubServiceTest test` |
| FR7 | Backend | `githubAppAuthService.test.js` | `disables access and revokes the cached installation token`; `revokes cached tokens when the installation mapping changes`; `does not revoke tokens when the mapping is unchanged` (then disable still revokes the cached token); `keeps the project disabled even when revocation fails` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR8 | Backend | `githubAppAuthService.test.js` | `mints a repo-scoped installation token with the minimum permissions` asserts the audit payload (including the permission object) and no token | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| FR9 | Backend/Agent | `githubAppAuthService.test.js`; `GitHubTokenProviderTest.java`; `AgentConfigTest.java`; `githubAppDeploymentWiring.test.js` | `requires ALLOW_PAT before returning a stored PAT`; `rejectsAPatWhenAllowPatIsDisabled`; `rejectsABackendModeThatDisagreesWithTheAgent`; `doesNotUseThePatFallbackForADefinitiveBackendRejection`; `testGitHubAuthModeIsExplicitAndValid`; `forwards the App variables to the api service`; `passes the auth mode flags to pool agents` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand`; `cd agent && mvn -Dtest=AgentConfigTest test` |
| FR10 | Backend/Agent | `githubAppAuthService.test.js`; `GitHubTokenProviderTest.java`; `GitHubServiceTest.java` | `rejects a project whose installation is disabled`; `fails closed when App credentials are missing`; `maps a network failure to a fail-closed mint error`; `classifies rate-limit responses separately`; `refreshesAndRetriesOnceAfterA401`; `refreshesAndRetriesOnceWhenPullRequestCreationReturns401`; `failsClosedWhenTheBackendReturnsNoToken` | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand`; `cd agent && mvn -Dtest=GitHubTokenProviderTest test` |
| NFR1 | Backend/Agent | `githubAppAuthService.test.js`; `GitHubTokenProviderTest.java`; `WorkspaceManagerTest.java` | Audit payload excludes the token; provider holds tokens in memory only; stale askpass directories are removed | commands above |
| NFR2 | Backend/Agent | `githubAppAuthService.test.js`; `GitHubServiceTest.java`; `WorkspaceManagerTest.java` | Disabled, missing config, rejected mint, rate limit, network failure and scope mismatch fail closed; GitHub/git 401s refresh once then fail | `cd backend && npx jest src/__tests__/githubAppAuthService.test.js --runInBand` |
| NFR3 | All | This matrix | Fake GitHub/backend; no live API | `cd backend && npm test`; `cd agent && mvn test` |
| NFR4 | Docs | `05_RUNBOOK.md` | Registration, mapping, rotation, revocation, fallback, rollback | `node planning/check-planning.js` |

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | author | none | Implementation plan and verification matrix | n/a |
| 1 | independent reviewer | B1 numeric/string owner comparison rejected real owners; B2 revocation called a nonexistent GitHub endpoint; B3 `/repo/agent` returned PATs to any agent key; B4 the PAT/env fallback was fetched but not wired into the credential source; B5 PAT mode ignored `disabled_at`. | Fixed string-safe ownership checks and tests; revocation now uses `DELETE /installation/token` with the cached token and reports `revoked`/`cachedTokens`; `/repo/agent` applies the owner check; the token provider takes an explicit PAT fallback source; PAT mode and backend operations honor `disabled_at`. | pass |
| 2 | independent reviewer (re-review) | R1 `createTicketBranch`/`createTicketPR` compared `ticket.projectId` numerically and would reject pg BIGINT strings; R2 `const projectId` was reassigned in the branch/PR/delete controllers when the body omitted it. Both pre-existing, but they block the FR6 backend path. | Both comparisons are string-safe; `let projectId` in all three controllers; regressions cover a string ticket project id and body-less createPR/deleteBranch. | pass |
| 3 | independent reviewer | Deployment env not forwarded and pool agents missing mode flags; minted token scope not verified against the connected repo; no 401/force-refresh path; agent did not enforce mode agreement; mapping changes did not revoke old tokens. Minor: audit permission names, stale head, unused catch, no rate-limit classification. | Compose/env/PoolManager wiring + static test; post-mint `repositories` verification with token revocation; `forceRefresh` on the token endpoint plus 401 refresh/retry; expected-mode validation and allowPat checks; mapping-change token revocation; permission-object audit; rate-limit error code; docs and tests updated. | pass |
| 4 | independent reviewer (re-review) | R3-1 `createPullRequest` missed the 401 refresh wrapper; R3-2 an unchanged mapping PUT cleared the cache without revoking, losing the revocation handle. | `createPullRequest` uses `executeWithAuth` with a POST 401 regression; the cache is cleared/revoked only when the mapping actually changes, with a no-op PUT then disable regression. | pass |
| 5 | independent reviewer | AgentApp passed `provider::get`, so `refresh()` used the interface default and never force-refreshed; git clone/push and backend GitHub operations had no 401 recovery; mapping-change validation/runbook codes/head were stale. | `AgentApp` passes the provider object; a real-provider 401 test proves forced refresh; clone/push and backend branch/PR calls refresh and retry once; mapping validation is documented; runbook adds the new error codes; head and review rounds updated. | pass |
| 6 | independent reviewer | Minor: a 403 was treated as auth; a failed clone did not remove a partial destination before retry; no static guard against reintroducing `provider::get`; docs head stale. | Auth matching is limited to 401/auth messages with a matcher test; the clone retry removes the partial destination and asserts it; `AgentAppWiringTest` guards the provider object; head updated. | pass |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-14 | `fed9ecf` (PR #143) | `cd backend && npm test` (132 suites, 1638 tests) + `cd agent && mvn test` (543 tests, 5 skipped) + `node planning/check-planning.js` + `git diff --check` + compose config | Pass. Backend mints/caches/revokes installation tokens, exposes the token and mapping routes, and fails closed; App mode no longer returns the stored PAT. The agent refreshes the token through a provider and git/PR calls consume it from a token source. PAT fallback is explicit and wired through the provider. Review findings across rounds 1-5 are resolved with regression tests. |
