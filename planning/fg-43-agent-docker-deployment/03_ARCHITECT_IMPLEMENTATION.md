# 03 — Implementation (fg-43)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Define the host capacity model and reservation policy
- [ ] Write the sizing formula and examples for build/review/light agents
- [ ] Allow a computed pool of 0 and fail closed; add `POOL_PAUSED`
- [ ] Fix the `MAX_POOL_SIZE` parser so 0 is not coerced to 50
- [ ] Add a runtime pool pause/resume config endpoint (`{ paused, maxPoolSize }`) guarded by `POOL_ADMIN_TOKEN`
- [ ] Generate `POOL_ADMIN_TOKEN` with mode `0600` in `.env.agent-host` for host-init/recovery
- [ ] Keep `POOL_ADMIN_TOKEN` backend-only; filter it from `agent/docker-compose.host.yml` and the PoolManager agent env allowlist
- [ ] Map `AGENT_MAX_POOL_SIZE` (hard cap), `AGENT_POOL_SIZE` (capped override, can only lower) and `MAX_POOL_SIZE` (runtime)
- [ ] Resolve `AGENT_REPO_DIR` from the repo volume mountpoint for `df`/`du`
- [ ] Create `agent/host-init.sh` with `--dry-run` and `--yes`
- [ ] Generate a `.env.agent-host` consumed by Compose/PoolManager
- [ ] Add per-container CPU/RAM/PID/log limits
- [ ] Define role profiles (build, review, fixer, light poller) with one pool per role in Phase 1
- [ ] Decide the single-host topology (backend + PoolManager + agents on one Docker host)
- [ ] Add compose deployment file and health checks
- [ ] Persist `POOL_PAUSED=false`, add a backend startup health gate, and wait for `/health`; a restart resumes automatically
- [ ] Add validation, logging and override behavior
- [ ] Document multi-host/remote-Docker as a follow-up
- [ ] Keep Kubernetes out of scope for this ticket

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-33, fg-34

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | | | | |
| FR2 | | | | |
| FR3 | | | | |
| FR4 | | | | |
| FR5 | | | | |
| FR6 | | | | |
| FR7 | | | | |
| FR8 | | | | |
| FR9 | | | | |
| FR10 | | | | |
| FR11 | | | | |
| FR12 | | | | |
| FR13 | | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
