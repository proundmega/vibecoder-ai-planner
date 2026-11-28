# 05 — Runbook (fg-57)

> Operational procedure for connecting a self-hosted Git provider. Test-only
> setup: use a disposable repository and disposable credentials. Never point a
> test at a production repository.

## Provider choice

| Provider | Typical footprint | Use when |
|---|---|---|
| **Forgejo/Gitea** | ~1–2 vCPU, 1–2 GB RAM, small disk for a team | You want a lightweight self-hosted PR UI |
| **GitLab self-hosted** | Omnibus is significantly heavier; plan multi-GB RAM and CPU | The organisation already runs GitLab |
| **Local bare repo over SSH** | Negligible; just a filesystem/SSH account | You only need branch publishing and manual diff review |

For a private application where the main requirement is “code must not live on
a foreign host,” start with Forgejo/Gitea or a bare repo. GitLab is correct only
if you already operate it.

## Preconditions

- A disposable self-hosted Git server or bare repository.
- A dedicated test project/repository.
- A scoped token or deploy key; never a personal all-repo token.
- Backend `GIT_*`/provider base URL configured.
- The model-provider privacy policy is still enforced; self-hosted Git does not
  make the model local.

## Forgejo/Gitea

1. Run a pinned, disposable instance:

   ```bash
   docker run -d --name forgejo-test \
     -p 3000:3000 -p 2222:22 \
     -v forgejo-test-data:/data \
     codeberg.org/forgejo/forgejo:9.0.3
   ```

   For Gitea, use the `gitea/gitea:1.22.6` image with the same ports. Replace
   the tag with the release pinned for the test host.

2. Create a test user and repository. Do not enable public registration on a
   host reachable from untrusted networks.
3. Create a repository-scoped access token with repository read/write and
   pull-request permissions.
4. In the planner, connect the project with:
   - provider: `forgejo` or `gitea`
   - repo URL: `http://<host>:3000/<owner>/<repo>.git`
   - base URL: `http://<host>:3000`
   - auth mode: `project_token` or `pat`
   - token: the scoped token

   The repository URL must match the base URL origin: same scheme, host and
   port, or `ssh://git@<host>/...` / `git@<host>:...` with the same host. HTTP(S)
   userinfo and `.`/`..` path segments are rejected. If the instance is served
   from a sub-path (for example `https://<host>/forgejo`), connect with the
   `owner/repo` shorthand so the base path is preserved.

   Provider-neutral API: `GET /api/v1/git/:projectId/repo` (status),
   `GET /api/v1/git/:projectId/repos` (all connections),
   `GET /api/v1/git/:projectId/repo/agent` (agent credential),
   `POST /api/v1/git/:projectId/token` (agent token),
   `POST /api/v1/git/:projectId/repo/connect`,
   `GET /api/v1/git/:projectId/branches|reviews`,
   `POST /api/v1/git/:ticketId/branch|review` and
   `GET /api/v1/git/:ticketId/review/diff`. The `/api/v1/github/...` routes
   remain GitHub-only aliases.

   Connect/disconnect require `PROJECT_MANAGE_MEMBERS`; the read and ticket
   routes require the project owner or a super admin (stricter than the legacy
   `/github` reads). `PROJECT_MANAGE_MEMBERS` is deployment-wide, not
   project-scoped, so a project admin can manage any project's connection while
   the read routes stay owner/super-admin only.

   The agent endpoints (`/repo/agent`, `/token`, `/:ticketId/review`) accept a
   node credential and rely on the runtime's `(node, project, role)` grant plus
   its `current_project_id` scope, so a pool node owned by another user can
   serve a granted project. Legacy agent keys keep the owner check. GitHub credentials
   (both app and pat modes) always go through `GitHubAppAuthService.mintToken`,
   so PAT issuance keeps its audit event and repo binding.

   The tracked `backend/src/api/openapi-generated.json` is produced with
   `npm run generate:spec`; regenerate it whenever the route JSDoc changes
   (`fg-57f3` refreshed it, so the `/git` routes and the agent token route are
   current).

5. In the UI, open the project → **Git** (the legacy `/github` URL redirects).
   The provider picker lists the registered providers; choose GitHub, Forgejo,
   Gitea or Local, then fill the repository URL, the base URL for self-hosted
   hosts, the auth mode, and the token or SSH key. The connection card and
   status show the provider, default branch and the latest review URL
   (`branch-only` for local). The same page lists and creates branches and
   reviews for the active provider; a local bare/SSH repository is
   agent-managed, so it shows a branch-only note instead of manual controls.
6. Verify the backend provider with the gated integration test
   (`FORGEJO_BASE_URL`, `FORGEJO_TOKEN`, `FORGEJO_REPO`): it connects, creates a
   branch, creates exactly one PR, reads the diff and cleans up.
7. Run one worker. The agent fetches the provider-scoped credential from
   `/api/v1/git/:projectId/token`, clones/pushes over HTTPS and then opens the
   review through `POST /api/v1/git/:ticketId/review` with the pushed
   `headBranch` and the run's `baseBranch`. The backend owns the provider
   client, so the agent never needs the Forgejo/Gitea API URL, and the request
   is idempotent. The HTTPS bearer token is only sent to the configured
   provider origin (the provider base URL, or the repo URL origin for GitHub);
   a remote on another host gets no credential and fails closed. Then verify:
   - one branch is pushed;
   - exactly one PR/MR is created and a retry does not duplicate it;
   - the ticket moves to `review` with the PR/MR URL (or branch + SHA for the
     local bare/SSH fallback).
8. Clean up the PR/branch, repository, token and container.

## GitLab self-hosted

1. Use an existing disposable GitLab or a throwaway Omnibus container. Budget
   more CPU/RAM than Forgejo; do not run it on the same small host as the
   planner unless the host was sized for it.
2. Create a test project and a project access token with `api` and
   `write_repository`.
3. Connect with provider `gitlab`, the project clone URL, the GitLab base URL,
   auth mode `project_token`, and the token.
4. Run one ticket and verify the merge request, branch and cleanup.
5. Revoke the project token and delete the test project.

If GitLab is too heavy for the environment, implement and test against a
faithful API fake first; keep the real-instance verification as a later
follow-up.

## Local filesystem repository

1. Create or reuse a git repository under a root you control:

   ```bash
   git init --bare /srv/git/private-app.git
   ```

2. Set the **same absolute root** on both sides:

   - backend: `LOCAL_GIT_ROOT=/srv/git`
   - agent: `GIT_LOCAL_ROOT=/srv/git`
   - Compose: `GIT_LOCAL_ROOT_HOST_PATH=/srv/vibecode-local-git` and
     `GIT_LOCAL_ROOT=/srv/git`. Both `docker-compose.yml` (API) and
     `agent/docker-compose.yml` (supervisor) mount that host path at the same
     target; the Docker sandbox sees the workspace bind, not the source root.

   The API runs as `node` (uid 1000) and the agent as `agent` (uid 100). Make
   the source root writable by the agent user for pushes
   (`chown -R 100:101 /srv/vibecode-local-git`); the API only reads it and
   trusts the exact repository path with `safe.directory`, so a different
   owner is still readable. A cross-owned source is cloneable but a push fails
   in `receive-pack`, hence the agent ownership requirement.

   Host mode shares the filesystem. The backend image includes `git` for the
   connect-time repository check. The Docker smoke is:

   ```bash
   docker compose exec api git -C /srv/git/private-app.git rev-parse --is-bare-repository
   docker compose -f agent/docker-compose.yml exec supervisor \
     git -C /srv/git/private-app.git rev-parse --is-bare-repository
   ```

   A path either side cannot see fails the clone.

3. Connect with provider `local`, `file:///srv/git/private-app.git` (or the
   absolute path) and auth mode `none` (omitting auth mode for a file path
   now defaults to `none`; SSH URLs still default to `ssh`). The backend
   resolves the real path,
   requires it under `LOCAL_GIT_ROOT`, verifies it is a git repository and
   records the default branch. No credential is stored.
4. Run one ticket. The harness clones from the local path, pushes the branch and
   finishes with branch + SHA; review locally or in the Git UI.
5. Paths outside the root, symlink escapes, a non-repository path or a missing
   `LOCAL_GIT_ROOT` are rejected on connect and by the agent.

## Local bare repository over SSH

1. On a host the agent can reach, create a bare repo:

   ```bash
   git init --bare /srv/git/private-app.git
   ```

2. Create a dedicated SSH user/key restricted to that repository. Put the public
   key in `authorized_keys` with a command restriction if possible.
3. Give the agent the **private key** through the planner credential store, and
   a verified `known_hosts` entry. Never use `StrictHostKeyChecking=no`.
4. Connect with provider `local`, the SSH clone URL, auth mode `ssh`.
   The backend resolves the SSH host on connect. A host only the agent can
   resolve is rejected; use a name both sides resolve, or set
   `ALLOW_PRIVATE_HOSTS=1` / `GIT_ALLOW_PRIVATE_HOSTS=1` for a private host.
5. Run one ticket. The harness pushes the branch and finishes with a branch/SHA,
   no PR URL. Review the diff locally or in the Git UI.
6. Clean up the branch, deploy key and bare repo.

## Verification checklist

- [ ] Provider is `forgejo`, `gitea`, `gitlab` or `local` (not a hardcoded
      GitHub path)
- [ ] Repository and default branch validated
- [ ] Credential encrypted at rest and absent from logs/argv/prompt
- [ ] One branch, one PR/MR (or branch/SHA for local)
- [ ] Retry is idempotent
- [ ] Ticket reaches `review`
- [ ] No credential or test repository remains after cleanup
- [ ] Model-provider policy still applies to private code

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 401/403 on connect | Token scope, base URL or provider mismatch |
| 404 on repository | Wrong owner/repo or self-hosted base URL |
| Branch push rejected | Protected branch, read-only token or SSH key not authorized |
| Duplicate PR | Publish retry did not reuse the existing review |
| Local run has no review URL | Expected; use branch + SHA, not a dead PR link |
| Agent cannot clone | Deploy key, known_hosts or network policy |

## Cleanup

- Revoke the provider token/deploy key.
- Delete the test branch/PR/MR and test repository.
- Remove the planner project repo row.
- Stop and remove the disposable container and volume.
- Do not leave a test repository or token behind.
