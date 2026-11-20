# Enrolling a fleet node

A **node** is one host. Enroll it once with an owner-scoped join token; the
node then serves any number of projects and roles through explicit
`(node, project, role)` grants. Enrollment never takes a project, role or
provider — those are server-side concepts.

> **Clean cut (fg-54).** The previous project-bound agent identity, static key
> pair and client-asserted mode were removed. A token minted for the old model
> cannot be used here, and old credential files are rejected. Provider secrets
> are re-entered through the model registry; nothing is backfilled.

## 1. Prerequisites

- Backend `AGENT_ENROLLMENT_ENABLED=1` (or the fleet routes mounted).
- A HTTPS `BACKEND_URL` (plain HTTP is allowed only for loopback or with
  `ALLOW_INSECURE_AGENT_ENROLLMENT=1` for local/LAN testing).
- A host with Docker and a writable `repos` directory (`chown 100:101`).
- A model in the registry marked **verified** and tagged with the role you
  intend to run.

## 2. Mint a join token

**Fleet → Mint token**. The token is single-use by default, expires in 15
minutes by default, and is bound to your user (the node owner). Copy it once;
it is not shown again.

## 3. Configure the node

```bash
cp agent/agent.ini.example agent.ini
```

Edit the declared runtimes. The file must not contain keys or tokens:

```ini
[runtime "workers"]
role = worker
model = acme/claude-sonnet
count = 3
effort = high

[runtime "reviewers"]
role = reviewer
model = acme/claude-opus
count = 1
effort = max
```

The model ref is `<credential-name>/<model>` resolved inside the node owner
and project scope. An ambiguous or missing ref is rejected by the server; it
is never guessed. `effort` is optional and canonical
(`minimal|low|medium|high|max`); provider-specific values are mapped or
clamped by the adapter.

## 4. Run the supervisor

### Host on a separate machine

```bash
cp agent/docker-compose.remote.yml.example docker-compose.remote.yml

ENROLLMENT_TOKEN='enr_...' \
BACKEND_URL='https://planner.example.com' \
AGENT_NODE_NAME='build-host-1' \
AGENT_INI_PATH=./agent.ini \
docker compose -p build-host-1 -f docker-compose.remote.yml up -d
```

### Host on the planner's Docker network (dev)

```bash
cd agent
ENROLLMENT_TOKEN='enr_...' \
BACKEND_URL='http://api:3001' \
ALLOW_INSECURE_AGENT_ENROLLMENT=1 \
VIBECODE_NETWORK=vibecoder-ai-planner_default \
docker compose -p fleet-dev up supervisor
```

The supervisor:

1. exchanges the join token for a node credential pair (or loads the existing
   `/credentials/node.json`);
2. fetches the node config and declares the `agent.ini` runtimes;
3. spawns one child JVM per runtime with `AGENT_RUNTIME_ID`, `AGENT_ROLE`,
   `AGENT_LLM_MODEL` and optional `AGENT_EFFORT`;
4. reconciles on boot, re-run and `SIGHUP` (spawn missing, drain removed,
   leave matching untouched).

The child fetches its provider config per run from
`GET /api/v1/agent-nodes/:id/runtimes/:runtimeId/provider-config`; that is the
only plaintext secret path, it is `no-store` and it is audited.

## 5. Verify

```bash
docker logs -f <supervisor-container>
# Node authenticated via enrollment (nodeId=…)
# Supervisor reconciled: desired=3 running=3 spawned=3 drained=0
# Runtime workers-1 heartbeat accepted

docker exec <supervisor-container> ls -l /credentials/node.json
# -rw------- … /credentials/node.json
```

In **Fleet** the node shows `active`, the owner, the hostname and the last
heartbeat; each runtime shows its role, model, effort and status.

## 6. Restart and revoke

- **Restart** keeps the credential volume; no new token is needed.
- **SIGHUP** (`docker kill -s HUP <container>`) reloads `agent.ini` and drains
  only the removed/changed runtimes.
- **Drain** stops accepting new leases and stops runtimes after their current
  run.
- **Revoke** marks the node and its runtimes revoked; the next heartbeat is
  rejected and the runtime releases its claim and lease. Re-enroll with a new
  token.
- Deleting the credential volume loses the identity; mint a new token.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Supervisor config rejected: unknown key "api_key"` | Secrets are not allowed in `agent.ini`. Put the key in the model registry; the supervisor fetches it per runtime. |
| `Supervisor config rejected: unknown section` | Only `[runtime "<name>"]` sections are supported. Check spelling/case. |
| `No credential file and no ENROLLMENT_TOKEN` | Mount `AGENT_CREDENTIALS_FILE` or supply a fresh join token. |
| `Node enrollment request failed with HTTP 409` | The token was already used or exhausted. Mint a new one. |
| `Node enrollment request failed with HTTP 401` | Token expired, revoked, or minted for a different owner. |
| `Token is not valid for this node` / 403 heartbeat | The node was revoked/drained, or the runtime grant was removed. Re-grant or re-enroll. |
| Runtime stays `pending` | The model is unverified/disabled or not tagged with the runtime role. Verify it and add the role tag. |
| `409` when deleting a credential/model | It is still referenced by a runtime or model. Detach it first; deactivate or rotate instead. |
| `modelRef` rejected (400/409) | The `<credential>/<model>` ref is missing or ambiguous in the node owner/project scope. Use the registry name exactly. |
| Child keeps restarting | Check the child log for a provider-config 403/404 or a missing grant; the supervisor backs off, it does not spin. |
| Old credential file is rejected | Credential files are node-scoped; re-enroll the host with a new token. |
