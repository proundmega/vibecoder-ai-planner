# 05 — Runbook (bp-135)

Operational procedure for the two-layer CI Docker cleanup. The pipeline teardown
is the primary path; the scheduled Jenkins job is the safety net.

The current implementation uses the **local-socket variant** for the build/test
stages: the Agent, Sandbox, Supply Chain and Integration Tests stages share the
helper-selected daemon, and post cleanup uses the pipeline-captured host/ID.
The explicit-all-stages variant remains gated by the FR5 daemon check.

## Provisioning prerequisite

Adding `Jenkinsfile.cleanup` to the repository does **not** create the scheduled
job. Before the safety net exists, a Jenkins administrator must:

1. Create the dedicated node/label `vibecode-ci-docker` for the cleanup job
   only. The label must resolve to exactly one Docker host; do not use a label
   shared by several agents. The main pipeline keeps its existing agents and
   does not need this label.
2. Create a Pipeline job named `vibecode-ci-docker-cleanup` from
   `Jenkinsfile.cleanup`.
3. Set `CI_DOCKER_HOST` to the daemon used by the builds on the pinned host and
   `CI_DOCKER_DAEMON_ID` to the output of:
   ```bash
   DOCKER_HOST="$CI_DOCKER_HOST" docker info --format '{{.ID}}'
   ```
4. Run the job once manually with `DRY_RUN=true`. Review the listed resources,
   then run it again with `DRY_RUN=false`.
5. Enable the cron trigger (`H */6 * * *`). For more than one Docker daemon,
   create one job per host with its own expected daemon ID (D5).

Before enabling the cron, run the daemon compatibility gate in `03`. The
scheduled job itself only needs cleanup permissions; the build/test suite may
need the local socket or a less restricted proxy.

## Retention and parameters

| Setting | Default | Meaning |
|---|---|---|
| `CI_IMAGE_GRACE_HOURS` | `24` | Minimum age of a labelled CI image before the GC may remove it. |
| `CI_CONTAINER_GRACE_HOURS` | `2` | Minimum age of an orphan sandbox container/network before removal. |
| `CI_BUILD_GRACE_HOURS` | `6` | Minimum age of a stopped Compose project/build identifier before removal. |
| `CI_DOCKER_HOST` | required | Explicit daemon for the scheduled job. No local-socket fallback. |
| `CI_DOCKER_DAEMON_ID` | required | Expected `docker info --format '{{.ID}}'`; a mismatch aborts before deletion. |
| `DRY_RUN` | `false` in cron, use `true` for the first manual run | Report actions without changing resources. |

Grace periods are longer than the 60-minute pipeline timeout, so a concurrent
build is outside the deletion window. The GC also skips the current build ID,
images referenced by a running container, and the shared `:ci` aliases.

The cleanup daemon is captured by the Integration Tests stage with
`sh(returnStdout: true)` into the Jenkins pipeline variables `CI_DOCKER_HOST`
and `CI_DOCKER_DAEMON_ID`. Post cleanup uses those variables and verifies the
ID. If they are missing, it uses the explicit Jenkins `DOCKER_HOST` only when
the Agent, Sandbox, Supply Chain and Integration Tests stages use explicit
mode; in the local-socket variant it skips.
No file under the workspace is authoritative. The Agent, Sandbox, Supply
Chain and Integration Tests stages use explicit mode only if the
pre-implementation daemon gate passes; otherwise they stay on the existing
local-socket selection and only cleanup uses explicit mode. The Cypress stage
keeps its current `DOCKER_HOST` selection and stage-level `post { always }`
teardown in both variants, so its project is independent of the top-level
cleanup.

## Inspect (labelled resources)

```bash
# Project anchor: the network/volume labels are authoritative. Pulled services
# (redis, postgres, docker-proxy) do not carry com.vibecode.ci.
DOCKER_HOST="$CI_DOCKER_HOST" docker network ls \
  --filter label=com.docker.compose.project="$PROJECT" \
  --filter label=com.vibecode.ci=true
DOCKER_HOST="$CI_DOCKER_HOST" docker volume ls \
  --filter label=com.docker.compose.project="$PROJECT" \
  --filter label=com.vibecode.ci=true

# Project containers, including pulled services
DOCKER_HOST="$CI_DOCKER_HOST" docker ps -a \
  --filter label=com.docker.compose.project="$PROJECT"

# CI-built images and existing sandbox resources
DOCKER_HOST="$CI_DOCKER_HOST" docker images \
  --filter label=com.vibecode.ci=true
DOCKER_HOST="$CI_DOCKER_HOST" docker ps -a \
  --filter label=vibecode.sandbox.managed=true
DOCKER_HOST="$CI_DOCKER_HOST" docker network ls \
  --filter label=vibecode.sandbox.managed=true
DOCKER_HOST="$CI_DOCKER_HOST" docker compose ls -a
```

Never clean based on a name prefix alone. The local-dev project is
`vibecoder-ai-planner` and must always be excluded.

## Legacy backlog (one-time, manual)

The automatic GC only selects resources carrying the new labels. Sandbox
containers/networks already carrying `vibecode.sandbox.managed=true` remain
visible to it. Other resources created before this change need a one-time manual
pass. This procedure is never scheduled and is the only path allowed to consider
unlabelled resources.

### 1. Read-only inventory

```bash
DOCKER_HOST="$CI_DOCKER_HOST" docker compose ls -a
DOCKER_HOST="$CI_DOCKER_HOST" docker ps -a --format \
  '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.CreatedAt}}'
DOCKER_HOST="$CI_DOCKER_HOST" docker network ls --format \
  '{{.ID}}\t{{.Name}}\t{{.CreatedAt}}'
DOCKER_HOST="$CI_DOCKER_HOST" docker volume ls --format \
  '{{.Name}}\t{{.Driver}}'
# Volume creation dates are not available from `docker volume ls`:
DOCKER_HOST="$CI_DOCKER_HOST" docker volume inspect "$VOLUME" \
  --format '{{.CreatedAt}}'
DOCKER_HOST="$CI_DOCKER_HOST" docker images --format \
  '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}'

# Read-only helper view; it does not delete anything
DOCKER_HOST="$CI_DOCKER_HOST" \
CI_DOCKER_DAEMON_ID="$CI_DOCKER_DAEMON_ID" \
agent/scripts/jenkins-docker-cleanup.sh --legacy-inventory
```

Classify candidates using the old names and tags. `vibecode-agent:ci`,
`vibecode-agent-sandbox:ci` and `vibecode-sandbox-proxy:ci` are the **current
shared aliases — do not remove them**. The same applies to any image carrying a
`:ci` tag. Legacy removal candidates are only build-unique old tags such as
`vibecode-agent:<build>`, `vibecode-agent-sandbox:<build>` and
`vibecode-sandbox-proxy:<build>`, plus old `vibecode-<branch>-<build>` Compose
projects and their unique images. Exclude `vibecoder-ai-planner`, the exact
shared volumes `postgres_data`, `uploads_data` and `vibecode_repos`, and
anything whose ownership is unclear. Leave a project alone if it has a running
container or could belong to an active build.

### 2. Dry run

Write the exact commands to a file and inspect them; do not execute yet. Run
the project teardown from the repo root with the compose files used by the
build:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
docker compose -f docker-compose.yml -f docker-compose.test.yml \
  -f docker-compose.e2e.yml --profile e2e -p "$LEGACY_PROJECT" \
  down -v --rmi local --remove-orphans
```

An old build-unique image tag is removed by tag, never by image ID when the
image also carries a `:ci` tag:

```bash
docker image rm "vibecode-agent:${LEGACY_BUILD}"
```

Never use `docker system prune -a`, and never remove a volume whose name is not
prefixed by the validated legacy project.

### 3. Explicit confirmation

Record the candidate project names, image IDs, sizes and creation dates in the
ticket or change record. A second operator (or the ticket owner) must confirm
the list in writing before any deletion. If confirmation is missing, stop.

### 4. Execute and record

Run one project or image at a time, oldest first, after re-checking that no
running container belongs to it. Then re-run the inventory, record what was
removed in `03` Results, and leave anything ambiguous for a follow-up rather
than guessing.

## Manual dry run

```bash
DOCKER_HOST="$CI_DOCKER_HOST" \
CI_DOCKER_DAEMON_ID="$CI_DOCKER_DAEMON_ID" \
agent/scripts/jenkins-docker-cleanup.sh --orphans --dry-run
```

The dry run prints the daemon host, daemon ID and every resource it would
remove. It must not issue a delete, prune or `compose down` command.

## Recover

1. If the scheduled job fails, read the log for `daemon mismatch`, `DOCKER_HOST
   is required` or a Docker API error. Do not bypass the daemon check.
2. Verify the host and ID:
   ```bash
   DOCKER_HOST="$CI_DOCKER_HOST" docker info --format '{{.ID}}'
   ```
3. Re-run with `DRY_RUN=true`, inspect the list, then run with `DRY_RUN=false`.
4. If a build's `post` cleanup failed, the next scheduled GC is the recovery
   path. If the pipeline's `CI_DOCKER_HOST`/`CI_DOCKER_DAEMON_ID` variables are
   missing, post cleanup falls back to the explicit Jenkins `DOCKER_HOST` only
   when the Agent, Sandbox, Supply Chain and Integration Tests stages use
   explicit mode; otherwise it skips. Do not substitute an uncaptured local
   socket when the pipeline variables are missing; in the local-socket variant
   the captured host itself is the local socket and must be used explicitly. Do
   not manually run `docker system prune`.
5. If Jenkins itself is down, the scheduled job cannot run. Resources remain
   until Jenkins returns; a host-side timer is deferred (D1). For the existing
   pre-label backlog, use the manual legacy procedure above, not the cron job.

## Crash scenarios

| Crash point | Expected state | Recovery |
|---|---|---|
| Test failure or user abort | `post { always }` teardown runs before `cleanWs()` | Inspect the build log; no manual action if the project is gone. |
| Hard-killed agent / Jenkins crash | `post` never runs; resources remain | Scheduled GC removes them after the grace period. |
| Missing/stale pipeline daemon variables | In explicit-all-stages mode, `post` uses the explicit Jenkins `DOCKER_HOST` and computes the ID; in local-socket mode it skips | Check the build log; scheduled GC is the fallback. Never fall back to an uncaptured local socket or a workspace file; use the captured host when the local-socket variant selected it. |
| Daemon restart | Containers/projects may remain labelled | Scheduled GC after the grace period. |
| Wrong daemon selected | Cleanup aborts before any delete | Fix `CI_DOCKER_HOST`/`CI_DOCKER_DAEMON_ID` and re-run the dry run. |
| Pre-label backlog | New GC cannot select it | One-time manual legacy inventory/cleanup with written confirmation. |
| Local dev stack | Never selected | Explicit deny plus strict CI project pattern. |

## Rollback

1. Disable the cron trigger or delete the `vibecode-ci-docker-cleanup` job.
2. Revert the `Jenkinsfile`, `Jenkinsfile.cleanup`, helper, script and Compose
   label changes.
3. Labels and tags are inert; no database or application rollback is needed.
4. Build-scoped resources that remain can be removed manually only after the
   inspect commands above confirm the project name and labels.

## Do not

- Run `docker system prune -a` or any broad prune on the shared daemon.
- Pass an arbitrary `--compose-project`; only the strict
  `vibecode-<branch>-<build>` pattern is accepted.
- Target `vibecoder-ai-planner` or remove `postgres_data`, `uploads_data` or
  `vibecode_repos` outside a validated build-scoped project.
- Run the scheduled job on an agent without an explicit, verified daemon ID.
- Remove the shared `:ci` image tags during any cleanup.
- Remove an image by ID when it still carries a `:ci` tag; remove only an old build-unique tag.
- Trust a workspace file for the cleanup host/ID; the pipeline variables are authoritative.
- Delete pre-label resources without the read-only inventory, dry run and written confirmation above.
- Treat a name match as proof of ownership; verify the old project/image and exclude local dev.

## Review evidence

| Check | Command / signal | Expected |
|---|---|---|
| Job provisioned | Jenkins job `vibecode-ci-docker-cleanup` exists with cron | Visible in Jenkins |
| Dry run | `--orphans --dry-run` | Lists only labelled/old resources; no mutation |
| Post daemon | Build log shows pipeline-captured host/ID and post cleanup uses the same ID | No local-socket fallback or workspace-file override; mismatch aborts |
| Daemon compatibility | `DockerSandboxRunnerIntegrationTest` with explicit host and network suite | Recorded pass, local-socket fallback with the existing suite result as validation, or documented blocked status |
| Daemon guard | Wrong `CI_DOCKER_DAEMON_ID` | Non-zero exit before any delete |
| Post order | Forced-failure build log | Teardown logged before `cleanWs()` |
| `:ci` alias | Fixture with an old build label still tagged `:ci` | Any cleanup leaves it in place |
| Legacy inventory | `--legacy-inventory` and the no-label inventory commands | Lists old candidates, marks `:ci` shared/current; no mutation |
| Legacy confirmation | Written project/image list and second confirmation | Present before any manual removal |
| Local dev safe | Run dry run on a host with `vibecoder-ai-planner` | No local-dev resource listed |
