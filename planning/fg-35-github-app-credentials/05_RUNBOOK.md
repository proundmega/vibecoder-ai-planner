# 05 — Runbook (fg-35)

Operational procedures for GitHub App credentials. Status lives in `00`;
requirements are in `01`; the design is in `02`.

## 1. Register the GitHub App

Create one GitHub App for the deployment:

| Setting | Value |
|---|---|
| Homepage URL | deployment URL |
| Webhook | not required for token minting |
| Repository permissions | `contents: write`, `pull_requests: write`, `checks: read`, `metadata: read` |
| Organization/account permissions | none |
| Administration, actions, workflows, secrets | **not granted** |

Install the App on the repositories used by projects. Record the App id,
installation id and the private key in the deployment secret store. Never
commit the key or put it in a workspace `.env`.

## 2. Configure the backend

| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_AUTH_MODE` | yes | `app` (default) or `pat`. |
| `GITHUB_APP_ID` | app mode | App id. |
| `GITHUB_APP_PRIVATE_KEY` | app mode | PEM value, `\n`-escaped PEM, or `file:/run/secrets/github-app.pem`. |
| `GITHUB_APP_INSTALLATION_ID` | optional | Single-tenant/dev fallback when a project has no mapping row. |
| `GITHUB_TOKEN_TTL_SECONDS` | no | Client-side cap, 60–3600 (default 3600). GitHub still enforces its one-hour expiry. |
| `ALLOW_PAT` | no | Must be `true` for the explicit PAT fallback. Default `false`. |

The same `GITHUB_AUTH_MODE` and `ALLOW_PAT` values apply to the agent. The
repository's `docker-compose.yml` forwards these variables to the `api`
service, and `docker-compose.override.yml` defaults local development to
`pat` + `ALLOW_PAT=true`. For a file-based key, set
`GITHUB_APP_PRIVATE_KEY=file:/run/secrets/github-app.pem` and mount the key
read-only at that path (an example mount is commented in `docker-compose.yml`).

Pool agents receive `GITHUB_AUTH_MODE` and `ALLOW_PAT` from the backend
environment; the actual token/PAT is fetched from the backend, not put in the
container environment.

## 3. Map a project to an installation

As a project owner or admin with `PROJECT_MANAGE_MEMBERS`:

```bash
curl -X PUT "$BACKEND/api/v1/github/$PROJECT_ID/installation" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"installationId": 12345678, "repoAllowlist": ["acme/widgets"]}'
```

`repoAllowlist` accepts `owner/repo` or a bare repo name. An empty allowlist
permits only the project's connected repo. Changing the mapping revokes the
project's cached installation tokens, so rotate or disable first when
responding to a suspected compromise. Check the mapping:

```bash
curl "$BACKEND/api/v1/github/$PROJECT_ID/installation" \
  -H "Authorization: Bearer $JWT"
```

## 4. Verify token minting

As the project owner's agent:

```bash
curl -X POST "$BACKEND/api/v1/github/$PROJECT_ID/token" \
  -H "X-API-Key: $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"operation":"smoke"}'
```

Expected: `{ "token": "ghs_…", "expiresAt": "...", "mode": "app", "repo": "owner/repo", "installationId": … }`.
The token must not appear in the backend log. The audit event is
`github_app_token_issued` with project, installation, repo, permissions,
operation and expiry only.

## 5. Rotate the private key

1. Generate a new private key in the App settings and store it in the secret
   store as a new version.
2. Deploy the new key. The backend creates a fresh App JWT per mint; no restart
   is needed after the secret is mounted, but restart if the process caches the
   old value.
3. Verify one mint, then delete the old key in GitHub.

## 6. Revoke or disable access

Per project:

```bash
curl -X DELETE "$BACKEND/api/v1/github/$PROJECT_ID/installation" \
  -H "Authorization: Bearer $JWT"
```

This sets `disabled_at`, clears the project's cached tokens and revokes each
cached token with `DELETE /installation/token`. The next mint fails with
`GITHUB_ACCESS_DISABLED`. Re-run the `PUT` mapping to re-enable. If the backend
has no cached token (for example after a restart), the already-issued token
remains valid until GitHub's one-hour expiry; uninstall or suspend the
installation for an immediate stop in that case.

To revoke every token for an installation, remove or suspend the installation
in GitHub. The next mint fails with `GITHUB_INSTALLATION_REJECTED`.

## 7. PAT fallback (local development only)

```bash
GITHUB_AUTH_MODE=pat
ALLOW_PAT=true
```

Set both on the backend and the agent. The backend returns the stored PAT from
`project_repos` and the agent logs a warning. `ALLOW_PAT=true` with `app` mode
has no effect. Do not enable this in production. The agent's `GITHUB_TOKEN`
env fallback is a local override and is used only for transport failures after
the agent has explicitly opted into `pat`; a definitive backend rejection never
falls back. In `pat` mode the local env token is not subject to the project's
`disabled_at` flag, so do not rely on disabling a project to stop a developer's
local env token.

## 8. Migration from PATs

1. Register the App and install it on the project repos.
2. Set the App env values and leave `GITHUB_AUTH_MODE=app`.
3. Add the installation mapping for one project.
4. Run a clone/push/PR in that project and confirm the audit event.
5. Repeat per project. The stored PAT is no longer used in `app` mode.
6. Remove `ALLOW_PAT`/`GITHUB_TOKEN` from deployment configs when every agent
   runs in `app` mode.

## 9. Rollback

- Immediate: set `GITHUB_AUTH_MODE=pat` and `ALLOW_PAT=true` on the backend and
  agents, then restart. This restores the stored-PAT path.
- Code rollback: revert the image; migration `049` can be rolled back with
  `049_project_github_installations_rollback.sql` after the code no longer
  reads the table.

## 10. Troubleshooting

| Error code | Meaning | Action |
|---|---|---|
| `GITHUB_APP_NOT_CONFIGURED` | App id or private key missing/unreadable. | Check the env/secret mount; the key must be valid PEM. |
| `GITHUB_INSTALLATION_NOT_CONFIGURED` | No mapping row and no single-tenant fallback. | `PUT /github/:projectId/installation`. |
| `GITHUB_ACCESS_DISABLED` | Project access was disabled. | Re-upsert the mapping. |
| `GITHUB_REPO_NOT_ALLOWED` | Connected repo is outside the allowlist. | Fix `repoAllowlist`. |
| `GITHUB_REPO_SCOPE_MISMATCH` | Request named a different repo. | Omit `repo` or use the connected repo. |
| `GITHUB_INSTALLATION_REJECTED` | GitHub rejected the App JWT/installation. | Check App id, key, installation status and permissions. |
| `GITHUB_TOKEN_MINT_FAILED` | GitHub 5xx/timeout or no token in the response. | Retry; check backend egress. |
| `PAT_FALLBACK_DISABLED` | `pat` mode without `ALLOW_PAT=true`. | Set the flag only for local development. |

GitHub Enterprise Server is not supported in this iteration; the API base is
the public GitHub endpoint. GitHub rate limits are reported as
`GITHUB_RATE_LIMITED`; retry after the reset window.
