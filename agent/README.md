# Vibecode AI Agent

Worker node that polls a project for backlog tickets, runs an AI coding agent
against the project's repository, and reports results to the backend.

- Java 17 / Maven, packaged as a shaded JAR and a Docker image.
- Two auth modes: static `AGENT_ID` + `AGENT_API_KEY`, or **self-enrollment**
  with a one-time `enr_…` join token.
- Three repo modes: `auto`, `build`, `review` (see [Repo modes](#repo-modes)).
- New here? [ENROLLMENT.md](ENROLLMENT.md) is the step-by-step enrollment
  walkthrough; this file is the deployment map.

## Topology: pick the right Compose file

| File | Use when | Notes |
|---|---|---|
| `docker-compose.remote.yml.example` | Agent runs on **another machine** | Self-contained, no external network. Needs a reachable `BACKEND_URL` and a prebuilt `${AGENT_IMAGE}`. |
| `docker-compose.yml` | Agent runs on the **same Docker host** as the planner | Joins the planner's Compose network as `external`. Needs `VIBECODE_NETWORK` (or `ROOT_COMPOSE_PROJECT`). |
| `docker-compose.sandbox.yml` | Overlay for Docker sandboxing | Adds the restricted socket-proxy network; use only with a `docker-proxy` and a host-visible `/repos`. |

If you are off-host and see `network … declared as external, but could not be
found`, you used the second file by mistake — use the remote template.

## Quickstart: worker on a separate machine

```bash
git clone https://github.com/proundmega/vibecoder-ai-planner.git
cd vibecoder-ai-planner

docker build -t vibecode-agent:latest agent/

mkdir -p repos && sudo chown 100:101 repos   # build mode only
cp agent/docker-compose.remote.yml.example docker-compose.remote.yml
```

Mint a token in **Agents → Enrollment**, then:

```bash
ENROLLMENT_TOKEN='enr_...' \
BACKEND_URL='http://192.168.3.51:3001' \
AGENT_NAME='worker-1' \
AGENT_MODE=review \
ALLOW_INSECURE_AGENT_ENROLLMENT=1 \
docker compose -p worker-1 -f docker-compose.remote.yml up -d
```

- Backend must have `AGENT_ENROLLMENT_ENABLED=1`. For plain HTTP it also needs
  `ALLOW_INSECURE_AGENT_ENROLLMENT=1`; HTTPS is required otherwise.
- Start with `AGENT_MODE=review` to prove enrollment without a repo, then switch
  to `build`.
- The token is single-use and expires (default 15 min). Mint a new one per
  worker; use `-p worker-N` so credential volumes stay separate.

Verify:

```bash
docker logs -f worker-1-agent-1   # "Agent authenticated via enrollment (agentId=…)"
docker exec worker-1-agent-1 ls -l /credentials/agent.json   # -rw------- 0600
```

## Quickstart: same host as the planner (dev)

```bash
cd agent
ENROLLMENT_TOKEN='enr_...' \
BACKEND_URL='http://api:3001' \
AGENT_MODE=review \
ALLOW_INSECURE_AGENT_ENROLLMENT=1 \
VIBECODE_NETWORK=vibecoder-ai-planner_default \
docker compose -p enroll-test up agent
```

Or with a static key pair, as the local dev stack does:

```bash
AGENT_ID=1 AGENT_API_KEY=... PROJECT_ID=1 AGENT_MODE=review \
docker compose up -d agent
```

## Auth modes (`AGENT_AUTH_MODE`)

| Value | Behavior |
|---|---|
| `auto` (default) | Use `AGENT_ID` + `AGENT_API_KEY` when present, otherwise enroll. |
| `legacy` | Require the static pair; never enroll. |
| `enroll` | Require `ENROLLMENT_TOKEN` or an existing `AGENT_CREDENTIALS_FILE`. |

Enrolled nodes write access/refresh credentials to `AGENT_CREDENTIALS_FILE`
(`0600`). The file wins over `ENROLLMENT_TOKEN` on restart, so restarts do not
need a new token; deleting the volume does. `PROJECT_ID` is optional with
enrollment (the token supplies the project) and required for static credentials.

## Repo modes (`AGENT_MODE`)

| Value | Behavior |
|---|---|
| `auto` (default) | Legacy: a complete `REPO_OWNER`/`REPO_NAME` pair means build; otherwise review. |
| `build` | Always build. The project's connected repo wins; env pair is a fallback. Startup **fails** if neither resolves. |
| `review` | Never load a repo, clone or push. |

Build nodes read the project's connected repository from the backend at startup
(`GET /api/v1/github/:projectId/repo/agent`), so `REPO_OWNER`/`REPO_NAME` are
optional. A build node that fails with “no usable repository” has already
consumed its join token
— connect the repo, then mint a new token. Restart after changing the repo in
the UI.

Mode defaults differ: the remote template defaults to `build`; the standalone
`docker-compose.yml` and `.env.example` default to `auto`.

## Running without Docker

```bash
cd agent
./build.sh                 # mvn clean package + tests
mvn -B test                # tests only (844 tests, 10 skipped)
mvn -B package -DskipTests # JAR only → target/agent-*.jar
```

`run-agent.sh.example` is a template for a local run; copy it, fill it in, and
never commit real secrets.

## Operations

| Task | Command |
|---|---|
| Logs | `docker logs -f <container>` |
| Restart (keep identity) | `docker compose -p <name> restart agent` |
| Update | rebuild/pull the image, then `docker compose -p <name> up -d` |
| Stop | `docker compose -p <name> down` (add `-v` to drop credentials) |
| Revoke a node | Agent detail page → **Revoke Credentials**; re-enroll with a new token |
| Enrollment smoke test | `BACKEND_URL=… ENROLLMENT_TOKEN=… bash scripts/agent-enrollment-smoke.sh` |

The container runs as uid 100 / gid 101. `/credentials` is owned by that user,
so fresh named volumes are writable; a host bind for `/repos` must be chowned
(`sudo chown 100:101 repos`) for build mode.

## Configuration

Full variable reference: root [README.md](../README.md#agent-env-java). The
common ones:

| Variable | Description | Default |
|---|---|---|
| `BACKEND_URL` | Backend API base URL | _(required)_ |
| `AGENT_AUTH_MODE` | `auto`, `legacy`, `enroll` | `auto` |
| `AGENT_ID` / `AGENT_API_KEY` | Static credentials | _(legacy)_ |
| `ENROLLMENT_TOKEN` | One-time join token | _(enroll)_ |
| `AGENT_CREDENTIALS_FILE` | Persistent credential file | _(none)_ |
| `AGENT_MODE` | `auto`, `build`, `review` | `auto` |
| `PROJECT_ID` | Project scope | _(server-supplied when enrolled)_ |
| `REPO_OWNER` / `REPO_NAME` | Build fallback; server repo wins | _(none)_ |
| `REPO_CLONE_DIR` | Clone workspace | `/tmp/repos` (image: `/repos`) |
| `AI_PROVIDER` / `AI_MODEL` | Provider fallback; backend config wins | `claude` / `claude-sonnet-4-20250514` |
| `POLL_INTERVAL_MS` | Poll interval | `30000` |
| `MAX_TICKETS` | Tickets per cycle | `1` |
| `DRY_RUN` | Do not publish | `false` |
| `HARNESS_MODE` | `legacy` or `opencode` | `legacy` |
| `SANDBOX_MODE` | `host` or `docker` | `host` |

Provider settings (`AI_PROVIDER`, model, endpoint, key) are fetched from the
backend per agent; env values are fallbacks only, so new providers do not need
agent changes.

## Files

| Path | Purpose |
|---|---|
| `ENROLLMENT.md` | Self-enrollment walkthrough and troubleshooting |
| `Dockerfile` | Agent image (non-root, includes git/Node/OpenCode) |
| `docker-compose*.yml` | Deployment topologies (see above) |
| `.env.example` | Annotated environment template |
| `scripts/agent-enrollment-smoke.sh` | Enroll → verify credential file → restart |
| `scripts/sandbox-image-security.sh` | Pin/SBOM/vulnerability checks for sandbox images |
| `build.sh`, `run-agent.sh.example` | Local build and run helpers |

## Troubleshooting

See [ENROLLMENT.md § Troubleshooting](ENROLLMENT.md#troubleshooting) for the
full table. Fast checks:

- `TLS_REQUIRED` → use HTTPS, or set `ALLOW_INSECURE_AGENT_ENROLLMENT=1` on both
  agent and API for local testing.
- `Agent says review mode on a build worker` → set `AGENT_MODE=build`.
- `Permission denied` on `/credentials/agent.json` → image predates the
  `/credentials` ownership fix (rebuild), or the volume is root-owned (remove it
  and re-enroll).
- Agent cannot refresh → refresh family revoked/expired; re-enroll.
