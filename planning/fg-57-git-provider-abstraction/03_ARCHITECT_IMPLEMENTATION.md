# 03 — Implementation (fg-57)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status and
> deferrals (`00`), operational procedure (`05`).

## Purpose

Replace GitHub-only publishing with a provider-neutral Git contract while
keeping GitHub working. Deliver Forgejo/Gitea first, a local bare/SSH fallback,
and GitLab later in the same suite.

## Plan

**CRITICAL:** Keep the existing GitHub routes, tests and App installation path
green. Do not rename `pr_url` or `project_github_installations`.

1. **Core provider abstraction and local/SSH fallback**
   - Add `GitProvider` contract and provider registry.
   - Add `GitProjectService`; make `GitHubService` a compatibility facade.
   - Add generic `project_repos` columns and migration/rollback.
   - Add local/SSH credential storage and host-key verification.
   - Update harness adoption to accept branch + SHA.
   - Add unit tests for contract, credential redaction and local publish.

2. **Forgejo/Gitea provider**
   - Connect/validate repository and default branch.
   - Fetch a scoped token for the agent; clone/push branch.
   - Create/reuse a pull request; list/delete branches.
   - Add a disposable Forgejo/Gitea integration test.

3. **GitLab self-hosted provider**
   - Connect/validate and fetch a project access token.
   - Push branch and create/reuse a merge request.
   - Test against a GitLab API fake or disposable instance.

4. **API, UI and documentation**
   - Add `/api/v1/git/:projectId/...`; keep the GitHub-only `/github` compatibility routes.
   - Provider picker and connection status in project settings.
   - Ticket/run view shows PR/MR URL or branch + SHA.
   - Update `05_RUNBOOK.md`, `AGENTS.md` and indexes.

### Phase 1: Core contract and local/SSH

Files:

- `backend/src/providers/git/GitProvider.js` (new contract + helpers)
- `backend/src/providers/git/local.js` (new)
- `backend/src/services/GitProjectService.js` (new)
- `backend/src/services/GitHubService.js` (facade)
- `backend/src/migrations/063_git_provider.sql` + rollback
- `backend/src/services/HarnessRunService.js` (adoption condition)
- `agent/src/main/java/com/vibecode/agent/service/GitService.java` (new)
- `agent/src/main/java/com/vibecode/agent/service/GitCredentialProvider.java`
- `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` (facade)
- `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`
- tests under `backend/src/__tests__/` and `agent/src/test/java/`

### Phase 2: Forgejo/Gitea

Files:

- `backend/src/providers/git/forgejo.js` (new)
- `backend/src/providers/git/gitea.js` (alias or shared implementation)
- `backend/src/api/git.js` (new generic routes)
- `backend/src/controllers/gitController.js` (new)
- `backend/src/__tests__/integration/forgejoProvider.test.js` (new)
- `agent/src/main/java/.../service/BackendReviewClient.java` (new; backend-proxied review request)
- `agent/src/test/java/.../GitServiceTest.java` (provider cases)
- `05_RUNBOOK.md` deployment steps

### Phase 3: GitLab

Files:

- `backend/src/providers/git/gitlab.js` (new)
- `backend/src/__tests__/integration/gitlabProvider.test.js` (new)
- `05_RUNBOOK.md` resource/GitLab section
- UI provider option

### Phase 4: UI, docs and indexes

- `frontend/src/views/GitConnections.vue` (provider picker, connection status, branches/reviews)
- `frontend/src/composables/useGit.ts` and `frontend/src/api/git.ts` (generic client/state)
- `frontend/src/views/ProjectDetail.vue` and `frontend/src/router/index.ts` (`/projects/:id/git`; the legacy `/github` URL redirects)
- `backend/src/api/openapi-generated.json` (regenerated with `npm run generate:spec`)
- `AGENTS.md`, `PENDING.txt`, `planning/HARNESS_ROADMAP.md`
- `05_RUNBOOK.md`

## Per-file changes

### `backend/src/providers/git/GitProvider.js` (CREATE)

- Export `PROVIDERS`, capability flags, `parseRepoUrl`, `assertSafeBaseUrl` and
  the interface documentation.
- No provider secret is logged.

### `backend/src/services/GitProjectService.js` (CREATE)

- `connect(projectId, input)` validates provider, repo URL, base URL, auth mode
  and credential; stores encrypted values; never returns the credential.
- `getAgentCredential(projectId)` returns the token/key only to an authenticated
  runtime for an active repo.
- `createBranch`, `createReviewRequest`, `listBranches`, `deleteBranch`.

### `backend/src/services/HarnessRunService.js` (MODIFY)

- Change adoption/reconciliation from `pr_url IS NOT NULL` to
  `(pr_url IS NOT NULL OR head_sha IS NOT NULL)`.
- Keep failed/no-evidence release semantics.
- Add tests for branch-only adoption and duplicate-PR prevention.

### `agent/src/main/java/.../GitService.java` (CREATE)

- Provider-neutral clone, branch, commit, push and optional review request.
- Uses `GitCredentialProvider`; no provider name in the harness code.

### `agent/src/main/java/.../HarnessTicketProcessor.java` (MODIFY)

- Call `GitService.createReviewRequest` when supported; otherwise publish
  branch + SHA and finish successfully.
- Record `pr_url` only when the provider returned one.

### `backend/src/api/git.js` (CREATE) and `api/github.js` (MODIFY)

- Generic routes mounted at `/api/v1/git` for every provider. `/api/v1/github`
  keeps its GitHub-only handlers for compatibility.
- `/git` reads require the project owner or a super admin; `/github` reads keep
  their existing token-only behaviour. The divergence is intentional (the
  generic surface is stricter) and documented in `05_RUNBOOK.md`.
- The two agent endpoints (`/repo/agent`, `/token`) authorize node credentials
  through the runtime project grant and its `current_project_id` scope rather
  than node-owner equality, so a pool node can serve a granted project.
- GitHub credentials always use `GitHubAppAuthService.mintToken` (app or pat),
  preserving the audit event and repo binding; non-GitHub providers return the
  stored scoped credential.
- `POST /git/:ticketId/review` accepts node credentials (runtime + ticket
  grant) and optional `headBranch`/`baseBranch`, so the harness can open the
  review for the branch it pushed. The service records the head branch on the
  ticket and overrides the provider's base branch for that request.

## Dependencies

- fg-35 and fg-54 merged.
- Disposable Forgejo/Gitea container for integration.
- An API fake or disposable GitLab for the later slice.
- No new npm/Maven dependency unless the provider client is unavoidable; prefer
  `fetch`/OkHttp.

## Verification matrix

| Req | ID | Scenario | Layer | Expected |
|---|---|---|---|---|
| FR1 | E1 | Same Git contract selects a provider | Backend unit | No hardcoded provider in harness publishing |
| FR2 | E2 | Connect Forgejo/Gitea repo with base URL/token | Backend HTTP | Repo stored; validation and default branch correct |
| FR2 | E3 | Bad base URL/credential | Backend HTTP | 4xx; no secret in response/log |
| FR3 | E4 | Push branch and create PR | Forgejo integration | One branch, one PR |
| FR3 | E5 | Retry publish | Forgejo integration | Existing PR returned; no duplicate |
| FR4 | E6 | GitLab connect and create MR | GitLab fake/integration | MR created once; default branch correct |
| FR5 | E7 | Local bare/SSH publish | Agent/integration | Branch pushed; run succeeds; no review URL |
| FR6 | E8 | Branch-only reconcile | Backend integration | Run adopted to review; failed/no-evidence run still released |
| FR7 | E9 | `/git` route and `/github` compatibility | Backend HTTP | `/git` serves GitHub and other providers; `/github` stays GitHub-only; `/git` reads require owner/super-admin |
| FR8 | E10 | Credential storage and redaction | Unit/security | Encrypted at rest; absent from logs/argv/prompt |
| FR9 | E11 | Provider config validation | Backend HTTP | Clear 4xx; no base-branch write |
| FR10 | E12 | UI provider selection/status | Frontend/e2e | Provider and review/branch shown |
| FR11 | E13 | GitHub regression suite | Existing tests | All GitHub tests still pass |
| FR11 | E14 | Forgejo/Gitea contract suite | Integration | Green against disposable container |
| FR12 | E15 | Runbook/index updates | Docs | `05` covers all providers; index labels match `00` |
| NFR1 | E10 | Secret hygiene | Unit/review | No plaintext secret in DB/files/argv/logs/prompt |
| NFR2 | E16 | Revoked/unreachable provider | Integration | Publish fails closed; base branch untouched |
| NFR3 | E5 | Idempotent publish | Forgejo integration | No duplicate branch/PR |
| NFR4 | E17 | Privacy policy still enforced | Backend integration | Model-provider policy is unchanged |
| NFR5 | E13 | Backward compatibility | Existing suites | GitHub path unchanged |
| NFR6 | E18 | Full verification | CI | Backend unit/integration, agent `mvn test`, lint pass |

## Commands

```bash
cd backend
npm test
npm run test:integration
npm run lint

cd ../agent
mvn test
```

Provider integration (disposable):

```bash
docker run -d --name forgejo-test -p 3000:3000 -p 2222:22 \
  -v forgejo-test-data:/data codeberg.org/forgejo/forgejo:9.0.3
cd backend
FORGEJO_BASE_URL=http://localhost:3000 \
  FORGEJO_TOKEN=<repository-scoped-token> \
  FORGEJO_REPO=<owner>/<repo> \
  npm run test:integration -- forgejoProvider
```

The test skips unless all three `FORGEJO_*` variables are set. Set
`FORGEJO_PROVIDER=gitea` to run it against Gitea.

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-27 | `e8c38b8` (PR #256) | Backend 171 suites / 2103 tests; agent 1156 tests / 0 failures / 10 skipped; contract 39 | `fg-57f2b` (D19): the harness opens Forgejo/Gitea reviews through node-authenticated `POST /git/:ticketId/review` with the pushed head/base; the backend records the branch and reuses an existing review. Local/SSH stays branch-only. |
| 2026-11-27 | `06b73a4` (PR #261) | Frontend 71 files / 619 tests; `vue-tsc` and build clean; backend 171 suites / 2114 tests; contract 39 | `fg-57f3` (D18): project → Git page with provider picker, connection status and provider-scoped branches/reviews; generic client/composable; `/github` redirects; tracked `openapi-generated.json` refreshed. Provider review URLs are http(s)/same-origin validated on both sides and on single-review reads; local stays agent-managed in both views, with the project-tab gating covered by a view test. |
| 2026-11-27 | `925ea2e` (PR #263) | Agent 1180 tests; backend 173 suites / 2150 tests; contract 39 | `fg-57d2a` (D16): the agent only sends the HTTPS token to the configured provider origin on clone, push and fast-forward. A configured http/ssh/invalid origin fails closed (never the legacy path), an unreadable remote fails closed, and the askpass helper returns the credential only for the exact `https://host[:port]` authority, matching scheme/host case-insensitively via POSIX-sh patterns (IPv6 and Git's `oauth2@` userinfo included). Local filesystem/SSH work follows as `fg-57d2b`. |
| 2026-11-28 | `bf88242` (PR #271) | Backend 174 suites / 2163 tests; agent 1196 tests; frontend 71 files / 621 tests; contract 39 | `fg-57d2b1` (D13): local `file://`/absolute repositories are accepted only under `LOCAL_GIT_ROOT` on the backend and `GIT_LOCAL_ROOT` on the agent, with realpath containment, symlink-escape rejection, git-root/default-branch validation and auth mode `none`. Both clone paths share the check and file/SSH remotes never fetch a token. Docker mode mounts the root in the API and supervisor, the API trusts the resolved repo with `safe.directory`, and the source is writable by the agent user for pushes. SSH clone/push remains `fg-57d2b` (D21). |
| 2026-11-28 | `efff4c3` (PR #275) | Agent 1205 tests; backend 174 suites / 2166 tests; frontend 71 files / 621 tests; contract 39; agent image build | `fg-57d2b` (D21): SSH/scp remotes (including absolute paths and single-segment repos) clone and push through a transient `GIT_SSH` wrapper with `ssh -F /dev/null`, strict known-hosts checking and `ProxyCommand=none`; the project deploy key or a mounted regular-file key is used, missing/symlinked known-hosts or keys fail closed, stale temp keys are swept, and SSH remotes never fetch an HTTPS token. The image keeps the 100:101 identity using the `_ssh` GID created by `openssh-client`. |
| 2026-11-28 | `d4f8152` (PR #279) | Backend 174 suites / 2179 tests; frontend 71 files / 621 tests; contract 39 | `fg-57g` (D1): GitLab self-hosted repositories (HTTPS only; SSH/scp rejected), subgroups and relative URL roots connect with a project access token; branch create/delete/list, merge-request create/reuse, review diff/head and raw file reads use the GitLab v4 API with URL-encoded project paths and `PRIVATE-TOKEN`; API redirects are refused, a missing ref defaults to the default branch/HEAD, diff paths are quoted, an explicit `providerProjectId` is honored during validation, and the generic service extracts `/-/merge_requests/<iid>` numbers. Unit-tested against a GitLab API fake; a real disposable instance remains the optional smoke. |

| Field | Value |
|---|---|
| Residual provider rows | none (verify) |
| Forgejo/Gitea evidence | — |
| GitLab evidence | Unit fake (`gitProviders`); real instance optional |
| Local/SSH evidence | — |

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep
a copy.
