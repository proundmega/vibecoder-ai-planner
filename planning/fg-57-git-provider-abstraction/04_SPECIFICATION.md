# 04 — Specification (fg-57)

> **Owns:** exact file operations and the test-first contract for the first
> slice.
> **Not here:** design rationale (`02`), verification matrix (`03`), status and
> deferrals (`00`), runbook (`05`).

## Scope of this specification

This is the executable slice order for **Phase 1** (provider abstraction,
local/SSH fallback, GitHub compatibility) and **Phase 2** (Forgejo/Gitea).
GitLab is a later slice and should not block these.

## Assumptions

| # | Assumption | Impact if wrong |
|---|---|---|
| 1 | `project_repos.provider` exists and is safe to extend | A migration is still required to add base URL/auth/SSH columns |
| 2 | The existing GitHub path must stay for one release | Keep `/github` aliases and GitHub tests |
| 3 | A Forgejo/Gitea container is disposable | Use a fixed test project and clean up |
| 4 | SSH host keys can be distributed to the agent host | Never disable host-key checking |
| 5 | The model-provider policy is unchanged | Self-hosted Git does not imply a local model |

## Test-First Requirement

Before production code:

1. Create `backend/src/__tests__/gitProviders.test.js` with stub tests for the
   provider registry, capability flags and safe base URL validation.
2. Create `backend/src/__tests__/integration/gitProvider.test.js` with stubs for
   connect, credential fetch and branch-only reconcile.
3. Create `agent/src/test/java/com/vibecode/agent/service/GitServiceTest.java`
   with stubs for clone/push/review-request capability.
4. Create `backend/src/__tests__/integration/forgejoProvider.test.js` with
   skipped integration stubs gated by `FORGEJO_BASE_URL`.
5. Only then implement the production files.

## File operations — Phase 1

1. **CREATE** `backend/src/providers/git/GitProvider.js`
   - Provider ids, instance capabilities, `assertSafeBaseUrl` and the registry.
     Repository parsing stays provider-specific; the GitHub adapter delegates to
     the existing parser. `assertSafeBaseUrl` is async (DNS) and must be awaited.
2. **CREATE** `backend/src/providers/git/local.js`
   - Local/SSH clone URL, deploy-key validation, branch-only review result.
3. **CREATE** `backend/src/services/GitProjectService.js`
   - connect/get repo/get agent credential/create branch/review request.
4. **MODIFY** `backend/src/services/GitHubService.js`
   - Delegate to `GitProjectService` while preserving the public methods used by
     `githubController`.
5. **CREATE** `backend/src/migrations/063_git_provider.sql` and
   `063_git_provider_rollback.sql`
   - Add `provider_base_url`, `provider_project_id`, `auth_mode`,
     `ssh_key_encrypted`; backfill `provider='github'`, `auth_mode='app'`.
6. **MODIFY** `backend/src/api/v1/index.js`
   - Mount `/git`; keep `/github`.
7. **CREATE** `backend/src/api/git.js` + `backend/src/controllers/gitController.js`
   - Generic handlers; reuse the GitHub handlers where the shape is identical.
8. **MODIFY** `backend/src/services/HarnessRunService.js`
   - Adoption accepts `head_sha` or `pr_url`; preserve release/reaper guards.
9. **CREATE** `agent/src/main/java/com/vibecode/agent/service/GitService.java`
   - Clone/branch/commit/push/review-request.
10. **CREATE** `agent/src/main/java/com/vibecode/agent/service/GitCredentialProvider.java`
    - Token or SSH key from the backend; no provider name in the harness.
11. **MODIFY** `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`
    - Use `GitService`; finish successfully when a branch was pushed without a
      review URL.
12. **MODIFY** `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java`
    - Add `GIT_AUTH_MODE`, `GIT_TOKEN`, `GIT_SSH_KEY_FILE`,
      `GIT_SSH_KNOWN_HOSTS`; keep GitHub aliases.

## File operations — Phase 2

1. **CREATE** `backend/src/providers/git/forgejo.js` (shared implementation for
   Forgejo/Gitea).
2. **MODIFY** `backend/src/services/GitProjectService.js` to register the
   provider.
3. **CREATE** `backend/src/__tests__/integration/forgejoProvider.test.js`
   - Connect, branch, PR create/reuse, cleanup; skipped without a base URL.
4. **MODIFY** `05_RUNBOOK.md` with the disposable Forgejo/Gitea procedure.
5. **MODIFY** the project settings UI with the provider picker and status.

## Acceptance for this slice

- GitHub tests remain green.
- A local bare/SSH project can run one ticket end to end and reach `review`
  without a PR URL.
- A Forgejo/Gitea project can connect, push a branch and create exactly one PR.
- Provider credentials never appear in the database, argv, logs or prompt.
- `node planning/check-planning.js` passes.

## Out of scope for this specification

- GitLab implementation details (later slice).
- GitHub Enterprise Server.
- Forgejo Actions, signed commits, mirroring and webhooks.
- A local model provider.
