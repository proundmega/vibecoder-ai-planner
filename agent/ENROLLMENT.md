# Self-enrolling an agent node

This walks through joining a worker host to a project without copying a
long-lived API key. The node enrolls once with a short-lived join token, stores
its own credentials, and refreshes them automatically.

## 1. Prerequisites

- Backend enrollment is enabled: `AGENT_ENROLLMENT_ENABLED=true` (`1` works).
  Dev Compose enables it; production-style Compose defaults to `false`.
- For a build node, the project has a repository connected under
  **Manage GitHub**. The agent reads that repository from the server; you no
  longer need `REPO_OWNER`/`REPO_NAME`.
- Enrollment needs HTTPS unless the backend is on loopback or you explicitly set
  `ALLOW_INSECURE_AGENT_ENROLLMENT=1` for local testing. Behind a reverse proxy,
  set `TRUST_PROXY=1` on the API.

## 2. Mint a join token

In the UI: **Agents → Enrollment**

1. Select the project.
2. Name the token (e.g. `worker-1`).
3. Choose TTL, max uses, and optionally a provider.
4. **Mint join token** and copy the `enr_…` value. It is shown once.

The token expires (default 15 minutes) and is single-use by default.

## 3. Configure the node

```env
BACKEND_URL=https://planner.example.com
AGENT_AUTH_MODE=enroll
AGENT_MODE=build
ENROLLMENT_TOKEN=enr_...
AGENT_CREDENTIALS_FILE=/credentials/agent.json
```

- `AGENT_MODE=build` means the node must resolve a project repository. The
  server repository wins; `REPO_OWNER`/`REPO_NAME` are only a fallback.
  **Server-repo-only build nodes must set `AGENT_MODE=build`**: `auto` stays
  review unless the legacy env pair is present. The remote template defaults to
  `build`; the standalone `agent/docker-compose.yml` defaults to `auto`.
- `AGENT_MODE=review` runs review/validation work only and never clones or
  pushes.
- `AGENT_MODE=auto` is the legacy default: a `REPO_OWNER`/`REPO_NAME` pair means
  build, otherwise review. Use `build` for a server-repo-only build node.
- Do **not** set `AGENT_ID` or `AGENT_API_KEY` in enrollment mode.
- `PROJECT_ID` is optional; the server supplies the project from the token.
- The credential file must be on a persistent volume.

Provider settings come from the backend (`/agents/:id/provider-config`); choose
the provider on the join token. `AI_PROVIDER`/`AI_MODEL`/`AI_API_KEY` are
fallbacks only.

## 4. Run it

Using the remote template:

```bash
cp agent/docker-compose.remote.yml.example docker-compose.remote.yml
# edit it, then:
docker compose -f docker-compose.remote.yml up -d
```

Minimal Compose service:

```yaml
services:
  agent:
    image: vibecode-agent:latest
    environment:
      - BACKEND_URL=https://planner.example.com
      - AGENT_AUTH_MODE=enroll
      - AGENT_MODE=build
      - ENROLLMENT_TOKEN=enr_...
      - AGENT_CREDENTIALS_FILE=/credentials/agent.json
    volumes:
      - agent_credentials:/credentials
volumes:
  agent_credentials:
```

## 5. Verify

```bash
docker logs -f <agent-container>
```

Expected:

```text
Agent authenticated via enrollment (agentId=…)
Using project repository <owner>/<repo> from the backend
```

Check the credential file:

```bash
docker exec <agent-container> ls -l /credentials/agent.json
# -rw------- ... /credentials/agent.json
```

In the UI, the agent appears under **Agents**, and the join token shows one use.

## 6. Restart and revoke

- Restarting with the same volume reuses the credential file; no new token is
  needed.
- Deleting the volume requires a new join token.
- **Revoke** from the agent’s detail page (**Revoke Credentials**). The node
  must be enrolled again with a new token.

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| Enrollment tab missing or 404 | `AGENT_ENROLLMENT_ENABLED` is off, or you lack `AGENT_READ`. |
| `TLS_REQUIRED` | Use HTTPS, or set `ALLOW_INSECURE_AGENT_ENROLLMENT=1` for local testing. |
| `AGENT_CREDENTIALS_FILE is required` | Mount a persistent volume and set the path. |
| `AGENT_MODE=build but the project has no usable repository` | The node has already consumed its one-time join token. Connect a repo under **Manage GitHub**, then mint a new token (or configure `REPO_OWNER`/`REPO_NAME` before starting). |
| Agent says review mode on a build worker | Set `AGENT_MODE=build`. |
| Join token rejected | It is expired, revoked, or already used; mint a new one. |
| Agent cannot refresh | The refresh token family was revoked or expired; re-enroll. |
| Project repo changed in the UI | Restart the agent so it reloads the coordinates. |
