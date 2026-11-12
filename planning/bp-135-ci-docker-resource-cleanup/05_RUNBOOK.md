# 05 — Runbook (bp-135)

Operational procedure for the two-layer CI Docker cleanup. The pipeline teardown
is the primary path; the scheduled Jenkins job is the safety net.

## Provisioning prerequisite

Adding `Jenkinsfile.cleanup` to the repository does **not** create the scheduled
job. Before the safety net exists, a Jenkins administrator must:

1. Create the dedicated node/label `vibecode-ci-docker` (or update the label in
   both the main `Jenkinsfile` and `Jenkinsfile.cleanup`). The label must resolve
   to exactly one Docker host; do not use a label shared by several agents.
2. Create a Pipeline job named `vibecode-ci-docker-cleanup` from
   `Jenkinsfile.cleanup`.
3. Set `CI_DOCKER_HOST` to the same daemon the builds use and
   `CI_DOCKER_DAEMON_ID` to the output of:
   ```bash
   DOCKER_HOST="$CI_DOCKER_HOST" docker info --format '{{.ID}}'
   ```
4. Run the job once manually with `DRY_RUN=true`. Review the listed resources,
   then run it again with `DRY_RUN=false`.
5. Enable the cron trigger (`H */6 * * *`). For more than one Docker daemon,
   create one job per host with its own expected daemon ID (D5).

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

## Inspect

```bash
DOCKER_HOST="$CI_DOCKER_HOST" docker ps -a \
  --filter label=com.vibecode.ci=true
DOCKER_HOST="$CI_DOCKER_HOST" docker ps -a \
  --filter label=vibecode.sandbox.managed=true
DOCKER_HOST="$CI_DOCKER_HOST" docker images \
  --filter label=com.vibecode.ci=true
DOCKER_HOST="$CI_DOCKER_HOST" docker network ls \
  --filter label=vibecode.sandbox.managed=true
DOCKER_HOST="$CI_DOCKER_HOST" docker volume ls \
  --filter label=com.docker.compose.project
DOCKER_HOST="$CI_DOCKER_HOST" docker compose ls -a
```

Never clean based on a name prefix alone. The local-dev project is
`vibecoder-ai-planner` and must always be excluded.

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
   path. Do not manually run `docker system prune`.
5. If Jenkins itself is down, the scheduled job cannot run. Resources remain
   until Jenkins returns; a host-side timer is deferred (D1).

## Crash scenarios

| Crash point | Expected state | Recovery |
|---|---|---|
| Test failure or user abort | `post { always }` teardown runs before `cleanWs()` | Inspect the build log; no manual action if the project is gone. |
| Hard-killed agent / Jenkins crash | `post` never runs; resources remain | Scheduled GC removes them after the grace period. |
| Daemon restart | Containers/projects may remain labelled | Scheduled GC after the grace period. |
| Wrong daemon selected | Cleanup aborts before any delete | Fix `CI_DOCKER_HOST`/`CI_DOCKER_DAEMON_ID` and re-run the dry run. |
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
- Remove the shared `:ci` image tags during the age-based GC.

## Review evidence

| Check | Command / signal | Expected |
|---|---|---|
| Job provisioned | Jenkins job `vibecode-ci-docker-cleanup` exists with cron | Visible in Jenkins |
| Dry run | `--orphans --dry-run` | Lists only labelled/old resources; no mutation |
| Daemon guard | Wrong `CI_DOCKER_DAEMON_ID` | Non-zero exit before any delete |
| Post order | Forced-failure build log | Teardown logged before `cleanWs()` |
| Local dev safe | Run dry run on a host with `vibecoder-ai-planner` | No local-dev resource listed |
