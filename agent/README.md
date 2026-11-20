# Vibecode AI Agent

Host supervisor and worker runtime for the fg-54 agent fleet.

- **One container per host.** The container runs a **supervisor**, which enrolls
  the host as a **node**, declares the runtimes in `agent.ini`, and reconciles
  one child JVM per runtime.
- **Node credentials only.** A node is enrolled once with an `enr_…` join
  token. The credential file (`0600`) is the durable identity; provider keys
  are fetched per runtime over the authenticated node channel.
- **Server-enforced roles.** Worker, reviewer and planner are closed runtime
  roles. The client cannot assert or change its role; the backend checks the
  `(node, project, role)` grant on claim, review and planning paths.
- **No secrets in supervisor config.** `agent.ini` carries roles, model refs,
  counts and optional effort only. Unknown keys and secret-looking values are
  rejected at startup.

> **Clean cut (fg-54).** The previous model — one project-bound agent per
> container, a static key pair, a client-asserted mode and fused
> provider/model/role rows — has been removed. Existing agent containers must
> be replaced by a supervisor; provider credentials are re-entered through the
> model registry. There is no backfill or compatibility shim.

## Topology

| File | Use when | Notes |
|---|---|---|
| `docker-compose.remote.yml.example` | Host runs on **another machine** | Self-contained; needs a reachable `BACKEND_URL` and a prebuilt `${AGENT_IMAGE}`. |
| `docker-compose.yml` | Host runs on the **same Docker host** as the planner | Joins the planner's Compose network as `external`; set `VIBECODE_NETWORK` or `ROOT_COMPOSE_PROJECT`. |
| `docker-compose.sandbox.yml` | Overlay for Docker sandboxing | Adds the restricted socket-proxy network; requires a `docker-proxy` and a host-visible `/repos`. |

If an off-host deployment reports `network … declared as external, but could
not be found`, it used the second file; use the remote template.

## Quickstart: host on a separate machine

```bash
git clone https://github.com/proundmega/vibecoder-ai-planner.git
cd vibecoder-ai-planner

docker build -t vibecode-agent:latest agent/

mkdir -p repos && sudo chown 100:101 repos
cp agent/docker-compose.remote.yml.example docker-compose.remote.yml
cp agent/agent.ini.example agent.ini
# edit agent.ini: role, model ref, count and optional effort per runtime
```

Mint a join token in **Agents → Fleet → Mint token**, then:

```bash
ENROLLMENT_TOKEN='enr_...' \
BACKEND_URL='https://planner.example.com' \
AGENT_NODE_NAME='build-host-1' \
AGENT_INI_PATH=./agent.ini \
docker compose -p build-host-1 -f docker-compose.remote.yml up -d
```

- The token is single-use and expires (default 15 minutes). Mint one per host,
  not per runtime.
- The first boot writes `/credentials/node.json` (`0600`). Restarts reuse it;
  deleting the volume requires a new token and a fresh enrollment.
- Plain HTTP is accepted only for loopback or when
  `ALLOW_INSECURE_AGENT_ENROLLMENT=1` is set. Use HTTPS in production.

Verify:

```bash
docker logs -f build-host-1-supervisor-1
# "Node authenticated via enrollment (nodeId=…)"
# "Supervisor reconciled: desired=3 running=3 spawned=3 drained=0"
docker exec build-host-1-supervisor-1 ls -l /credentials/node.json
# -rw------- … /credentials/node.json
```

## Quickstart: same host as the planner (dev)

```bash
cd agent
cp agent.ini.example agent.ini
ENROLLMENT_TOKEN='enr_...' \
BACKEND_URL='http://api:3001' \
ALLOW_INSECURE_AGENT_ENROLLMENT=1 \
VIBECODE_NETWORK=vibecoder-ai-planner_default \
docker compose -p fleet-dev up supervisor
```

The example file starts one supervisor; the declared runtimes in `agent.ini`
determine how many children it launches.

## Runtime configuration (`agent.ini`)

```ini
[runtime "workers"]
role = worker
model = acme/claude-sonnet
count = 3
effort = high

[runtime "reviewers"]
role = reviewer
model = acme/claude-opus
count = 2
effort = max

[runtime "planners"]
role = planner
model = acme/claude-opus
count = 1
```

- `role` is `worker`, `reviewer` or `planner`.
- `model` is `<credential-name>/<model>` in the owner/project scope. Ambiguous
  refs are rejected by the server (400/409), never guessed.
- `count` spawns `<name>-1` … `<name>-N`; names are deterministic.
- `effort` is `minimal`, `low`, `medium`, `high` or `max`; omitted means the
  model default (`medium`).
- `project` is an optional worker hint. Grants decide authorization.
- Unknown keys, duplicate sections, invalid enums and any secret-looking key
  or value stop the supervisor at startup. Provider keys are fetched per
  runtime from the backend, never stored here.

## Supervisor lifecycle

| Event | Behavior |
|---|---|
| Boot | Enroll if needed, read the node config, spawn missing runtimes, adopt matching children from the previous supervisor. |
| Re-run / apply twice | No-op: matching children are left untouched. |
| `agent.ini` change + `SIGHUP` | Spawn additions; drain and stop removed or changed children only. |
| Child crash | Restart the child with backoff; the rest of the fleet is unaffected. |
| Supervisor crash (`kill -9`) | Children keep running; the restart adopts them and converges to the declared set. |
| Node revoked/drained | The next heartbeat is rejected; the runtime releases its claim and lease and stops. |

The supervisor tracks deterministic PID files under
`SUPERVISOR_PID_DIR` (default `/tmp/vibecode-runtimes`), so a crash does not
orphan children. Each child gets `AGENT_RUNTIME_HEAP_MB` (default 768 MB);
`SUPERVISOR_MEMORY_BUDGET_MB` divides a host budget across the declared count.

## Running without Docker

```bash
cd agent
./build.sh                 # mvn clean package + tests
mvn -B test                # tests only
mvn -B package -DskipTests # JAR only → target/agent-*.jar
```

`run-agent.sh.example` is a local-run template. Never commit real secrets.

## Operations

| Task | Command |
|---|---|
| Logs | `docker logs -f <supervisor-container>` |
| Restart (keep identity) | `docker compose -p <name> restart supervisor` |
| Update | rebuild/pull the image, then `docker compose -p <name> up -d` |
| Stop | `docker compose -p <name> down` (add `-v` to drop credentials) |
| Reload declared runtimes | edit `agent.ini`, then `docker kill -s HUP <supervisor-container>` |
| Drain a node | **Fleet → node → Drain**; runtimes stop after their current lease |
| Revoke a node | **Fleet → node → Revoke**; re-enroll with a new token |
| Enrollment smoke test | `BACKEND_URL=… ENROLLMENT_TOKEN=… bash scripts/agent-enrollment-smoke.sh` |

The container runs as uid 100 / gid 101. `/credentials` is owned by that user,
so fresh named volumes are writable; a host bind for `/repos` must be chowned
(`sudo chown 100:101 repos`).

## Configuration

| Variable | Description | Default |
|---|---|---|
| `BACKEND_URL` | Backend API base URL | _(required)_ |
| `ENROLLMENT_TOKEN` | One-time node join token (first boot only) | _(none)_ |
| `AGENT_CREDENTIALS_FILE` | Persistent node credential file | `/credentials/node.json` |
| `SUPERVISOR_CONFIG` | Runtime declaration | `/config/agent.ini` |
| `AGENT_RUNTIME_ID` | Runtime id set by the supervisor | _(supervisor)_ |
| `AGENT_ROLE` | Runtime role set by the supervisor | `worker` |
| `AGENT_LLM_MODEL` | Model ref set by the supervisor | _(server config)_ |
| `AGENT_EFFORT` | Optional runtime effort override | model default |
| `AGENT_RUNTIME_HEAP_MB` | Heap per child JVM | `768` |
| `SUPERVISOR_MEMORY_BUDGET_MB` | Host budget shared across children (`0` = off) | `0` |
| `SUPERVISOR_STOP_TIMEOUT_SECONDS` | Graceful drain budget | `10` |
| `REPO_CLONE_DIR` | Clone workspace | `/tmp/repos` (image: `/repos`) |
| `POLL_INTERVAL_MS` | Poll interval | `30000` |
| `MAX_TICKETS` | Tickets per cycle | `1` |
| `DRY_RUN` | Do not publish | `false` |
| `HARNESS_MODE` | `legacy` or `opencode` | `legacy` |
| `SANDBOX_MODE` | `host` or `docker` | `host` |

Provider settings (type, key, model, endpoint, effort) are fetched per runtime
from the backend. `AI_PROVIDER`, `AI_MODEL`, `AI_ENDPOINT_URL` and
`AI_API_KEY` remain development fallbacks only; they are not the fleet path.

## Files

| Path | Purpose |
|---|---|
| `ENROLLMENT.md` | Node enrollment walkthrough and troubleshooting |
| `agent.ini.example` | Supervisor runtime template (no secrets) |
| `Dockerfile` | Agent image (non-root, includes git/Node/OpenCode) |
| `docker-compose*.yml` | Deployment topologies (see above) |
| `scripts/agent-enrollment-smoke.sh` | Enroll → verify credential file → restart |
| `scripts/sandbox-image-security.sh` | Pin/SBOM/vulnerability checks for sandbox images |
| `build.sh`, `run-agent.sh.example` | Local build and run helpers |

## Troubleshooting

See [ENROLLMENT.md § Troubleshooting](ENROLLMENT.md#troubleshooting) for the
full table. Fast checks:

- `Supervisor config rejected: unknown key "api_key"` — remove the secret from
  `agent.ini`; provider keys belong in the registry.
- `No credential file and no ENROLLMENT_TOKEN` — mount
  `AGENT_CREDENTIALS_FILE` or supply a fresh token.
- `Node authenticated` followed by 403 on heartbeat — the node or runtime was
  drained/revoked, or the grant was removed. Re-grant or re-enroll.
- `401` on the first call — the node credential expired; the agent refreshes
  automatically once. If refresh fails, re-enroll.
