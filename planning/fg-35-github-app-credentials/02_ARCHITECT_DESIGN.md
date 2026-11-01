# 02_ARCHITECT_DESIGN.md - GitHub App Credentials and Least Privilege (fg-35)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1

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

## Open questions

1. Do we need one app per tenant or one app with per-project installations?
2. Should the agent talk to GitHub directly or always through a backend proxy?
3. How do we support GitHub Enterprise Server?
4. Phase 1 reviews are COMMENT-only; Phase 2 needs a separate reviewer App/identity. Confirm whether that is one app with two installations or a distinct app.
5. What is the minimum permission set for checks and merge queue later?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-34 | Tokenless sandbox with provider proxy | Security | `fg-34-harness-sandbox` | No |
| 2 | fg-41 | Credential audit events | Observability | `fg-41-harness-observability` | No |
| 3 | fg-42 | Secret scanning/redaction | Privacy | `fg-42-harness-privacy` | No |
| 4 | fg-36 | Merge queue permissions | Delivery | `fg-36-merge-lifecycle` | No |
