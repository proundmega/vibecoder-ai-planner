# 02_ARCHITECT_DESIGN.md - GitHub App Credentials and Least Privilege (fg-35)

## Design summary

Move GitHub authentication to a backend `GitHubAppAuthService` that mints short-lived installation tokens per project/repo. The agent asks for a token per run, uses it ephemerally, and never persists it.

```
Agent                    Backend                         GitHub
  |  POST /github/token    |                               |
  |----------------------->|  verify project/repo          |
  |                        |  check installation mapping   |
  |                        |  mint/cache token ----------->|
  |<-----------------------|  {token, expiresAt, repo}     |
  |  use token for clone/push/PR                          |
  |  discard token on run end                             |
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_AUTH_MODE` | `app` | `app` or `pat` |
| `GITHUB_APP_ID` | - | App id |
| `GITHUB_APP_PRIVATE_KEY` | - | Secret-store reference |
| `GITHUB_APP_INSTALLATION_ID` | - | Single-tenant/dev fallback; production uses per-project mappings |
| `GITHUB_TOKEN_TTL_SECONDS` | `3600` | Requested token lifetime |
| `ALLOW_PAT` | `false` | Dev-only PAT fallback |

`GITHUB_APP_INSTALLATION_ID` is a single-tenant/dev fallback only. Production resolves the installation per project (FR2):

```sql
CREATE TABLE project_github_installations (
  project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL,
  repo_allowlist TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The token service looks up `project_github_installations` first and falls back to the env var only when exactly one installation is configured.

## Token service

- Read the app private key from the secret store.
- Create a JWT (RS256, 10-minute expiry) and exchange it for an installation token with:
  - `repositories: [repoName]`;
  - `permissions: { contents: write, pull_requests: write, checks: read, metadata: read }`.
- Cache `(installationId, repo, permissions) -> token` until `expiresAt - 5 minutes`.
- Never cache across projects.
- Revoke on project disable and on suspected leak.

## How the agent uses the token

- Request a token per run from the backend using the agent API key.
- Clone with an ephemeral credential helper or `git -c http.extraHeader=... clone`; do not write it to `.git/config` or a remote URL.
- Push with the same ephemeral mechanism; the supervisor owns the push.
- PR creation uses the backend GitHub service or the token directly; either way, scope it to the repo.
- Drop the token from memory and never put it in the prompt.
- If a sandbox is used (fg-34), the token stays outside the sandbox; push happens in the supervisor.

## Error handling

- 401/403 from GitHub: clear the cache, retry mint once, then fail closed.
- Installation suspended/revoked: fail the run and alert.
- Token expires mid-run: mint a new one for the same scope; never widen permissions.
- Rate limits: back off and surface a clear error.

## Audit and rotation

- Store an audit event: project, repo, installation, permissions, requested_at, expires_at, operation, outcome.
- Never store the token.
- Rotate the app private key with an overlap window.
- Provide a per-project "disable GitHub access" switch that revokes cached tokens.

## Migration

1. Add the app service and token endpoint.
2. Support both `app` and `pat` modes.
3. Migrate one project; verify clone/push/PR.
4. Make `app` the default; keep `pat` behind `ALLOW_PAT=true`.
5. Remove PAT fallback after all deployments migrate.

## Tests

- mint and cache; expiry refresh;
- scope rejection across projects;
- no token in `.git/config`, logs, process args or prompts;
- revocation blocks the next operation;
- PAT fallback requires the flag;
- GitHub 401/403/rate-limit handling.

## Resolved decisions (2026-11-14)

1. **One App with per-project installations.** `project_github_installations` maps each project to an installation id and repo allowlist. `GITHUB_APP_INSTALLATION_ID` is a single-tenant/dev fallback only when no row exists.
2. **Direct agent use.** The backend mints a repo-scoped installation token; the agent uses it ephemerally for clone/push/PR and refreshes it before expiry. No git proxy in this slice.
3. **GHES is deferred.** The API base is the public GitHub endpoint; an override is a follow-up.
4. **Reviewer identity stays separate.** Publishing uses this App; COMMENT-only reviews remain in fg-31 Phase 1. A distinct reviewer App/identity is a Phase 2 item, not this ticket.
5. **Minimum permissions.** `contents:write`, `pull_requests:write`, `checks:read`, `metadata:read`; no `administration`, `actions` or `workflows` write. Merge-queue permissions are a later ticket (D3).

## Cache and failure behavior

- Cache key: `projectId + installationId + owner/repo`. A token is never returned for a different project even when the installation is shared.
- Client-side expiry: `min(GitHub expires_at, now + GITHUB_TOKEN_TTL_SECONDS)`; refresh five minutes before expiry. GitHub still enforces the one-hour server expiry.
- `GITHUB_AUTH_MODE=app` never reads or returns `project_repos.access_token_encrypted`. `GET /repo/agent` returns `accessToken: null`; agents use `POST /github/:projectId/token`.
- `GITHUB_AUTH_MODE=pat` requires `ALLOW_PAT=true` on the backend and agent. It returns the stored PAT for local development only and logs a warning.
- Disabling a project sets `disabled_at`, clears cached tokens and revokes each cached installation token with `DELETE /installation/token`. Token minting then fails with `GITHUB_ACCESS_DISABLED`. If the backend has no cached token (for example after a restart), the already-issued token remains valid until GitHub's one-hour expiry or until the installation is uninstalled/suspended; the runbook records this.

## Failure modes and recovery

| Failure | Behavior | Recovery |
|---|---|---|
| App id/private key missing | Token request fails `GITHUB_APP_NOT_CONFIGURED`; publishing stops. | Set both values, restart the backend, retry. |
| Installation mapping missing | Token request fails `GITHUB_INSTALLATION_NOT_CONFIGURED`. | Create the mapping with `PUT /github/:projectId/installation` or set the single-tenant env fallback. |
| Project disabled | Token request fails `GITHUB_ACCESS_DISABLED`. | Re-enable by upserting the mapping, then retry. |
| Repo outside allowlist / mismatch | `GITHUB_REPO_NOT_ALLOWED` / `GITHUB_REPO_SCOPE_MISMATCH`; no token is minted. | Fix the allowlist or connected repo. |
| GitHub 401/403/404 on mint | `GITHUB_INSTALLATION_REJECTED`; no fallback. | Check App permissions, installation suspension and key rotation. |
| GitHub 5xx/timeout | `GITHUB_TOKEN_MINT_FAILED`; no fallback. | Retry the run; check backend egress. |
| Token expires mid-run | The agent refreshes through the provider before the next git/PR call. | None; if GitHub rejects it, the run fails closed and the next attempt mints again. |
| Revocation/disable during a run | Cached tokens are revoked immediately; a token not in the cache stays valid until GitHub expiry. The next mint fails and the next run stops. | Re-enable or reinstall, then retry. |
| Backend unreachable | The agent cannot mint; publishing stops. | Restore the backend; no PAT fallback in `app` mode. |

## Security considerations

- The token is repo-scoped, permission-limited and short-lived; the App private key stays server-side and is never sent to the agent.
- The token is delivered in an authenticated JSON response, held in memory, and written only to the transient askpass script (mode `0700`, deleted immediately).
- The token is never in `.git/config`, `remote -v`, argv, the model prompt, ticket messages, run errors or logs. GitHub App audit events log project, installation, repo, permissions and expiry only.
- Cross-project isolation is enforced by the mapping/allowlist and a project-scoped cache key; a request for a different repo is rejected before minting.
- The backend still stores a PAT for legacy connection validation; in `app` mode it is neither returned to agents nor used for operations.
- `ALLOW_PAT` is false by default. Enabling it is an explicit local-development decision and is logged.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
