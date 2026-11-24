# 02 — Design (fg-57)

> **Owns:** current-state audit, design, data flow, contracts, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file operations
> (`04`), status and deferrals (`00`).

## Current State

### Backend

- `backend/src/services/GitHubService.js` inserts `project_repos` with
  `provider = 'github'` and uses `GitHubProvider` for parse/validate/PR calls.
- `backend/src/services/GitHubAppAuthService.js` hardcodes `api.github.com`,
  `project_github_installations`, installation tokens and GitHub App JWTs.
- `backend/src/api/github.js` exposes `/api/v1/github/:projectId/...` for repo
  status, connect, branches, PRs and the agent token.
- `project_repos` already has a `provider` column, but the service does not read
  it; `access_token_encrypted` is the only credential slot.
- `backend/src/services/HarnessRunService.js` records `pr_url` and treats it as
  publish evidence for adoption/reconciliation.

### Agent

- `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` resolves
  repository, clone URL, branch creation, commit and PR creation.
- `GitHubTokenProvider` fetches the backend GitHub credential.
- `AgentConfig` carries `GITHUB_AUTH_MODE`, `ALLOW_PAT`, `GITHUB_TOKEN`.
- `HarnessTicketProcessor` calls `gitHubService.createPullRequest(...)` and
  publishes `pr_url`.

### Gap Analysis

| Capability | Covered by | Gap |
|---|---|---|
| GitHub hosting | GitHubService + App auth | Works, must stay compatible |
| Forgejo/Gitea | none | No provider, base URL or token path |
| GitLab self-hosted | none | No MR API or project token path |
| Local bare/SSH | none | No branch-only publish or review evidence |
| Provider-neutral API | `/github` only | Route, UI and DB are GitHub-shaped |
| Branch-only publish | `pr_url` required for adoption | Local runs cannot be reconciled as published |

---

## Design

### Provider contract

Backend and agent share the same conceptual interface:

```text
GitProvider (instance; the factory receives the credential)
  id                      github | forgejo | gitea | gitlab | local
  capabilities            { supportsReviewRequests, supportsInstallations,
                            reviewRequestName, authModes }
  parseRepoUrl(url)
  validateRepoAccess(url, credential = this.credential)
  validateCredential(credential = this.credential)
  getDefaultBranch(url)
  getCloneUrl(url)
  getFileContent(repo, path, ref)
  createBranch(repo, ticketId, ticketTitle)
  deleteBranch(repo, branchName)
  listBranches(repo)
  createReviewRequest(repo, ticketId, ticketTitle, branchName, description)
                          -> { id, url, number } | null
  listReviewRequests(repo)
  getReviewDiff(repo, reviewNumber)
```

Credentials are supplied to the provider factory and carried by the instance;
callers do not pass a token to every method. The backend does not push
branches — the agent's `GitService` owns clone/push — so `pushBranch` is
intentionally absent. This instance shape, implemented by `fg-57a`, is
canonical for `fg-57b` onward.

Capability flags on the instance keep GitHub App installations and
Forgejo/GitLab tokens out of the same code path without branching in every
caller.

### Data model

Extend `project_repos` rather than creating a provider-specific table:

| Column | Purpose |
|---|---|
| `provider` | `github`, `forgejo`, `gitea`, `gitlab`, `local` |
| `provider_base_url` | Self-hosted API/UI base URL; null for github.com |
| `provider_project_id` | Numeric/string project id where the API needs it |
| `auth_mode` | `app`, `pat`, `project_token`, `ssh`, `none` |
| `access_token_encrypted` | Existing encrypted PAT/project token slot |
| `ssh_key_encrypted` | Optional encrypted deploy key for local/SSH |
| `default_branch` | Existing |
| `repo_url` | Existing canonical clone URL |
| `is_active` | Existing |

`provider_github_installations` stays for GitHub App mode; no generic
installation table is needed in the first slice. Forgejo/Gitea and GitLab use
scoped tokens; local/SSH uses a deploy key.

### Backend

New provider directory:

```text
backend/src/providers/git/
  GitProvider.js          common contract + capability flags
  github.js               wraps the existing GitHub provider
  forgejo.js              Forgejo/Gitea API implementation
  gitlab.js               GitLab MR implementation
  local.js                bare/SSH branch-only implementation
```

New service:

```text
GitProjectService
  connect(projectId, { provider, repoUrl, baseUrl, token, sshKey, authMode })
  getRepo(projectId)
  getAgentCredential(projectId)
  createBranch(projectId, ticket)
  createReviewRequest(projectId, ticket)
  listBranches(projectId)
  deleteBranch(projectId, branch)
```

`GitHubService` becomes a thin compatibility facade over
`GitProjectService` so the existing `/github` routes and tests keep working.

### HTTP API

Add provider-neutral routes:

```text
GET    /api/v1/git/:projectId/repo
POST   /api/v1/git/:projectId/repo/connect
DELETE /api/v1/git/:projectId/repo
GET    /api/v1/git/:projectId/repo/agent
POST   /api/v1/git/:projectId/token
GET    /api/v1/git/:projectId/branches
POST   /api/v1/git/:ticketId/branch
DELETE /api/v1/git/:ticketId/branch
GET    /api/v1/git/:projectId/reviews
POST   /api/v1/git/:ticketId/review
```

`/api/v1/github/...` remains mounted as an alias with the same handlers. The
connect body gains `provider`, `baseUrl`, `authMode` and optional `sshKey`.
`repoUrl` still identifies the repository and is validated per provider.

### Agent

Replace GitHub-specific classes with:

```text
GitService                 clone, branch, commit, push, review request
GitCredentialProvider      token or SSH key from the backend
GitProviderConfig          provider, base URL, auth mode, capabilities
```

`AgentConfig` gains `GIT_AUTH_MODE`, `GIT_TOKEN`, `GIT_SSH_KEY_FILE`,
`GIT_SSH_KNOWN_HOSTS`; GitHub variables remain aliases for one release.

### Harness publishing

- `HarnessRunService.recordPublish` continues to store `head_sha` and an
  optional `pr_url` (the review URL for any provider).
- `finishRun` keeps `pr_url` nullable.
- `reconcileRun` adoption condition becomes
  `(pr_url IS NOT NULL OR head_sha IS NOT NULL)`, not PR-only.
- For local branch-only runs, the project shows `branch` + `head_sha` and the
  ticket moves to `review`; no dead PR link.
- A failed run with no branch/head evidence still releases the ticket.
- The reaper and adapter must not retry a branch that was already pushed;
  publish is idempotent.

### UI

- Project settings provider picker: GitHub, Forgejo/Gitea, GitLab, Local.
- Fields: repository URL, base URL, auth mode, token or deploy key.
- Connection status shows provider, branch, latest review URL or SHA.
- Ticket/run views show PR/MR URL when present, otherwise branch + SHA.

### Data Flow

```text
Ticket + project
   │
   ▼
Harness publishes branch via GitService
   │  provider = forgejo | gitea | gitlab | github | local
   ▼
GitProjectService / provider API
   │  push branch
   ├── Forgejo/Gitea/GitLab: create PR/MR -> review URL
   └── local/SSH: no URL -> branch + SHA
   ▼
HarnessRunService: head_sha + optional pr_url
   ▼
Ticket -> review; human reviews in provider UI or local diff
```

---

## Config / Environment Changes

| Variable | Purpose |
|---|---|
| `GIT_PROVIDER` | Optional default provider for legacy callers |
| `GIT_AUTH_MODE` | `app`, `pat`, `project_token`, `ssh`, `none` |
| `GIT_TOKEN` | Dev/local fallback only; not the fleet path |
| `GIT_SSH_KEY_FILE` | Agent deploy key for local/SSH |
| `GIT_SSH_KNOWN_HOSTS` | Verified host keys; never disable host checking |
| `GIT_ALLOW_PRIVATE_HOSTS` | Reuse the existing private-host policy, not a new bypass |
| `FORGEJO_BASE_URL` | Optional operator default |
| `GITLAB_BASE_URL` | Optional operator default |

No new provider secret is ever written to `agent.ini` or the prompt.

## Database Changes

- New migration `063_git_provider.sql` (verify the number is free at
  implementation time):
  - add `provider_base_url`, `provider_project_id`, `auth_mode`,
    `ssh_key_encrypted` to `project_repos`;
  - expand/relax the provider value if a check constraint exists;
  - backfill existing rows with `provider = 'github'`, `auth_mode = 'app'`.
- Each migration has a rollback.
- Existing `project_github_installations` stays untouched.

## Failure Handling and Cleanup

- **Provider unreachable:** publish fails closed; the run is failed/recoverable;
  the base branch is untouched.
- **Auth expired/revoked:** fail closed with a clear message; no retry loop that
  burns credentials.
- **Duplicate branch/PR:** reuse the existing branch/SHA and PR; never force-push.
- **Local branch-only:** finish succeeds with `head_sha`; review is manual; the
  reaper adopts only when the branch/SHA evidence is present.
- **Provider removed:** open PRs remain valid; future publishes are disabled.
- **Cleanup:** revoke the token/deploy key, delete the branch/PR when safe, and
  remove the project repo row; never delete the repository itself.

## Security Considerations

- Encrypt tokens and SSH keys at rest; never return them to the UI.
- The agent fetches credentials per run over the authenticated node channel.
- Reject credentials in URLs, argv, logs and prompts; keep redaction tests.
- Validate self-hosted base URLs and reuse the existing SSRF/private-host policy.
- Verify SSH host keys; do not add `StrictHostKeyChecking=no`.
- Scope tokens to one repository/project; prefer project access tokens.
- Self-hosted Git does not make the model local; fg-42 policy still applies.
- Rate-limit connect and review calls; audit provider changes.

## Risks and Edge Cases

1. **Provider API drift** — pin Forgejo/Gitea/GitLab versions and contract-test
   the used endpoints.
2. **PR/MR idempotency** — a retry after a successful push must not create a
   second review request.
3. **GitLab cost** — document resource minimums and keep it a later slice.
4. **Local review UX** — a branch without a PR link needs a visible diff/SHA.
5. **Existing GitHub evidence** — PR-only adoption is a real behaviour change;
   test failed-run release and duplicate-PR prevention.
6. **SSH key distribution** — per-repo deploy keys, not a shared host key.
7. **Backward compatibility** — `/github` aliases and existing tokens must keep
   working for one release.
8. **Model residency** — Git hosting is not model hosting; private code still
   reaches the configured provider.

## Alternatives Considered

### Alternative 1: Add GitLab first

- Pros: common in organisations.
- Cons: resource-heavy, slower to run locally, more API surface. Rejected as the
  first slice; kept as slice 3.

### Alternative 2: Local bare repo only

- Pros: smallest infrastructure.
- Cons: no PR UI, weaker review ergonomics. Keep as a fallback, not the only
  path.

### Alternative 3: Separate service per provider

- Pros: isolated deployments.
- Cons: duplicates auth, evidence and UI. Rejected in favour of one provider
  contract.

## Rollout

1. Land the abstraction and local/SSH fallback with GitHub compatibility.
2. Add Forgejo/Gitea and validate against a disposable container.
3. Add GitLab behind the same contract.
4. Update UI, runbook and indexes.
5. Keep GitHub as the default; no forced migration.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep
a copy.
