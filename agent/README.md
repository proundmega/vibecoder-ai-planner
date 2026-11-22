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
# "Supervisor reconciled: desired=2 running=4"
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
project = 1

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

- `role` is `worker`, `reviewer`, `planner` or `light`.
- `model` is `<credential-name>/<model>` in the owner/project scope. Ambiguous
  refs are rejected by the server (400/409), never guessed.
- `count` spawns `<name>-1` … `<name>-N`; names are deterministic.
- `effort` is `minimal`, `low`, `medium`, `high` or `max`; omitted means the
  model default (`medium`).
- `project` is **required for worker and light sections** (Track A’s declare
  contract).
  Grants decide authorization; the value is a declaration hint, never trusted.
- Unknown keys, duplicate sections, invalid enums and any secret-looking key
  or value stop the supervisor at startup. Provider keys are fetched per
  runtime from the backend, never stored here.

## Host sizing (fg-43)

`agent/scripts/host-init.sh` sizes the host for the declaration before the
supervisor starts. It parses `agent.ini`, sums the role profiles, subtracts the
OS/Docker/supervisor reservation, fails closed if the fleet does not fit, and
writes `.env.agent-host` (mode `0600`). There is no `PoolManager`, no pool admin
token and no `MAX_POOL_SIZE`: the fg-54 supervisor owns the runtime children.

| Role | CPU | RAM | Disk |
|---|---|---|---|
| `worker` | 2.0 | 3 GB | 20 GB |
| `reviewer` | 1.5 | 2.5 GB | 10 GB |
| `planner` | 1.5 | 2.5 GB | 10 GB |
| `light` | 0.5 | 1.5 GB | 5 GB |

`light` is a sizing variant and runs as a worker child; it does not invent a
server role.

Reference case: 3 workers + 2 reviewers + 2 planners = **7 runtimes**, 12 CPU,
19 GB and 100 GB. On a 48-thread / 192 GB / 2 TB host it fits (binding `cpu`);
the script writes `AGENT_HOST_MAX_RUNTIMES=50`,
`AGENT_HOST_DECLARED_RUNTIMES=7`, `SUPERVISOR_CPUS=7.00`,
`SUPERVISOR_MEMORY_BUDGET_MB=5376` and `SUPERVISOR_MEMORY_LIMIT=7G`.

```bash
# detect, parse, print the formula, write nothing
AGENT_INI_PATH=agent.ini agent/scripts/host-init.sh --dry-run --explain

# validate this host (no write, no start)
AGENT_INI_PATH=agent.ini agent/scripts/host-init.sh --check

# write .env.agent-host (use --force to replace an existing file)
AGENT_INI_PATH=agent.ini agent/scripts/host-init.sh

# write and start the supervisor stack, then wait for /health
AGENT_INI_PATH=agent.ini agent/scripts/host-init.sh --yes
```

Exit codes: `2` arguments, `3` host/Docker/sandbox/repo validation, `4`
`agent.ini`, `5` over capacity, `6` Compose/health.

The script supports `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT`,
`AGENT_DISK_BUDGET_GB`, `AGENT_UTILIZATION_TARGET`,
`AGENT_RUNTIME_HEAP_MB`, `SANDBOX_CPUS`, `SANDBOX_MEMORY_MB`,
`SANDBOX_DISK_MB`, `AGENT_LOG_MAX_SIZE` and `AGENT_LOG_MAX_FILE`.
`AGENT_HOST_CPU_THREADS`, `AGENT_HOST_RAM_GB` and `AGENT_HOST_DISK_GB` are
deterministic overrides for tests/CI.

`SANDBOX_MODE=docker` adds `agent/docker-compose.sandbox.yml` and requires
`SANDBOX_HOST_WORKSPACE_ROOT` plus a writable `REPO_HOST_PATH`. The generated
env file is canonicalized and passed explicitly, so a caller's relative
`AGENT_INI_PATH` cannot become a Compose named volume.

Compose reads `SUPERVISOR_CPUS`, `SUPERVISOR_MEMORY_LIMIT`,
`AGENT_LOG_MAX_SIZE` and `AGENT_LOG_MAX_FILE` from the env file:

```bash
docker compose --env-file .env.agent-host \
  -f agent/docker-compose.yml [-f agent/docker-compose.sandbox.yml] up -d --build
```

The supervisor refuses to start if `agent.ini` grows past
`AGENT_HOST_MAX_RUNTIMES` (default `50`); re-run `host-init.sh` after changing
role counts. `AGENT_HOST_MAX_RUNTIMES=0` disables the guard for a hand-managed
host.

## Supervisor lifecycle

| Event | Behavior |
|---|---|
| Boot | Enroll if needed, read the node config, spawn missing runtimes, adopt matching children from the previous supervisor. A section already `stopped`/`draining` or whose grant was revoked is not re-declared, so it stays retired across a restart. |
| Re-run / apply twice | No-op: matching children are left untouched. |
| `agent.ini` change + `SIGHUP` | Spawn additions; drain and stop removed or changed children only. |
| Child crash | Restart the child with backoff; the rest of the fleet is unaffected. |
| Supervisor crash (`kill -9`) | Children keep running; the restart adopts them and converges to the declared set. |
| Node revoked/drained | The next heartbeat is rejected; the runtime releases its claim and lease and stops. |
| Section grant revoked | Only that section is suspended; the host keeps serving its other projects. |
| Every section suspended | The supervisor stays up and idle, then re-declares when a grant or runtime is restored. |

The supervisor tracks deterministic PID files under
`SUPERVISOR_PID_DIR` (default `/tmp/vibecode-runtimes`), so a crash does not
orphan children. Each child gets `AGENT_RUNTIME_HEAP_MB` (default 768 MB);
`SUPERVISOR_MEMORY_BUDGET_MB` divides a host budget across the declared count.
Before enrollment or the first spawn, the supervisor waits for
`BACKEND_URL/api/health` with a bounded retry
(`SUPERVISOR_HEALTH_*`); set `SUPERVISOR_HEALTH_REQUIRED=false` only for an
offline local run.

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
| `ENROLLMENT_URL` | Override the enrollment endpoint (defaults to `BACKEND_URL` + `/api/v1/agent-nodes/enroll`) | _(derived)_ |
| `AGENT_CREDENTIALS_FILE` | Persistent node credential file (0600); required — enrollment fails without it | `/credentials/node.json` (image) |
| `SUPERVISOR_CONFIG` | Runtime declaration | `/config/agent.ini` |
| `AGENT_RUNTIME_ID` | Runtime id set by the supervisor | _(supervisor)_ |
| `AGENT_RUNTIME_NAME` | Runtime name set by the supervisor | _(supervisor)_ |
| `AGENT_ROLE` | Runtime role set by the supervisor | `worker` |
| `AGENT_LLM_MODEL` | Model ref set by the supervisor | _(server config)_ |
| `AGENT_EFFORT` | Optional runtime effort override | model default |
| `HARNESS_QUESTION_LOOP` | Enable the fg-55 human question loop | `false` |
| `HARNESS_QUESTION_TIMEOUT_MINUTES` | How long a waiting question blocks before it expires | `60` |
| `HARNESS_QUESTION_POLL_SECONDS` | Poll interval while waiting for an answer | `5` |
| `HARNESS_DOOM_LOOP_MAX` | Consecutive identical tool calls before asking a human | `3` |
| `HARNESS_DOOM_LOOP_CONTINUES` | Human continues allowed before the run aborts | `3` |
| `AGENT_PROJECT_ID` / `PROJECT_ID` | Optional project hint; backend grants are authoritative (`AGENT_PROJECT_ID` is supervisor-set from the runtime declaration) | _(none)_ |
| `AGENT_RUNTIME_CONCURRENCY` | Runtime concurrency set by the supervisor | `1` |
| `AGENT_RUNTIME_STOP_FILE` | Drain marker path set by the supervisor | _(supervisor)_ |
| `AGENT_NODE_ID` | Optional node-id override; normally derived from the node credential | _(none)_ |
| `AGENT_RUNTIME_HEAP_MB` | Heap per child JVM | `768` |
| `SUPERVISOR_MEMORY_BUDGET_MB` | Host budget shared across children (`0` = off) | `0` |
| `SUPERVISOR_STOP_TIMEOUT_SECONDS` | Graceful drain budget | `10` |
| `SUPERVISOR_HEALTH_REQUIRED` | Wait for backend `/api/health` before enrollment/declaration/spawn | `true` |
| `SUPERVISOR_HEALTH_TIMEOUT_SECONDS` | Maximum startup health wait | `120` |
| `SUPERVISOR_HEALTH_INTERVAL_SECONDS` | Health retry interval | `2` |
| `PROVIDER_CONFIG_REFRESH_SECONDS` | Re-read a rotated provider config between tickets (min 60) | `300` |
| `REPO_CLONE_DIR` | Clone workspace | `/tmp/repos` (image: `/repos`) |
| `REPO_OWNER` / `REPO_NAME` | Optional build fallback; the project's configured repository wins | _(none)_ |
| `POLL_INTERVAL_MS` | Poll interval | `30000` |
| `STALE_TIMEOUT_MS` | Stale ticket timeout | `3600000` |
| `MAX_TICKETS` | Tickets per cycle | `1` |
| `DRY_RUN` | Do not publish | `false` |
| `GITHUB_AUTH_MODE` | `app` (installation token) or `pat` (local development only) | `app` |
| `ALLOW_PAT` | Must be `true` to use the PAT fallback | `false` |
| `GITHUB_TOKEN` | Dev-only PAT fallback; never used in app mode | _(none)_ |
| `SANDBOX_MODE` | `host` or `docker` | `host` |

Provider settings (type, key, model, endpoint, effort) are fetched per runtime
from the backend. `AI_PROVIDER`, `AI_MODEL`, `AI_ENDPOINT_URL`, `AI_API_KEY`
and `AI_MAX_TOKENS` remain development fallbacks only; they are not the fleet
path.

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
