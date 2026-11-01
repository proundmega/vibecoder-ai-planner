# 02_ARCHITECT_DESIGN.md - Repository Onboarding and Environment Profiles (fg-39)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-34

## Design summary

A repo profile is a versioned, admin-approved description of how to prepare and verify a repository. The supervisor loads it before cloning/sandboxing and uses it to build the sandbox and run commands.

```
Project -> RepoProfile (versioned)
  -> SandboxImage + toolchains
  -> setup commands + caches
  -> services (postgres/redis)
  -> verify commands + timeouts
  -> flaky tests
```

## Profile schema

```json
{
  "version": 1,
  "repo_url": "https://github.com/org/repo",
  "base_branch": "master",
  "languages": ["node", "java"],
  "image": "vibecode/node24-java17:1",
  "setup": [
    "npm ci",
    "cd backend && npm ci",
    "cd frontend && npm ci"
  ],
  "verify": [
    "cd backend && npm test",
    "cd frontend && npm test -- --run",
    "cd agent && mvn test -q"
  ],
  "services": [
    { "name": "postgres", "image": "postgres:16-alpine", "env": "DATABASE_URL" }
  ],
  "env": { "NODE_ENV": "test", "INTEGRATION_TESTS": "1" },
  "caches": ["~/.npm", "~/.m2", "frontend/node_modules"],
  "timeouts": { "setup_minutes": 15, "verify_minutes": 20 },
  "flaky_tests": ["test/known-flake.test.js"],
  "max_round_minutes": 45
}
```

Profiles are validated against a JSON schema; unknown fields are rejected or warned.

## Onboarding flow

1. Admin adds a repo URL.
2. Detector reads manifests (`package.json`, `pom.xml`, `pyproject.toml`, `go.mod`, `docker-compose.yml`) and proposes a profile.
3. Admin edits/approves; a dry run clones the repo and runs setup/verify in the sandbox.
4. Profile is versioned; every harness run records the profile version used.

## Images and caches

- Start with a small set of prebuilt images: Node 24, Python 3.12, Java 21/17, Go, and a monorepo image with common tools.
- Pin images by digest; rebuild on a schedule (fg-34 supply chain).
- Cache directories are mounted from a per-repo cache volume, keyed by repo + profile version + lockfile hash.
- Cache is read-only for untrusted repo scripts where possible; writes go to a scratch layer, then a sanitized cache update.
- Never share caches across projects.

## Services

- Start service containers on an isolated network attached only to the sandbox.
- Health-check before running tests.
- Ephemeral data volumes; destroy after the run.
- Inject connection strings into the sandbox env (non-secret defaults or per-run generated credentials).
- If a service cannot start, fail fast with a clear profile error.

## Flaky tests

- Profile lists known-flaky tests.
- Verification retries only those tests (max 2) and records the flake.
- A consistent failure fails the run; flakes never hide a real regression.
- Emit a metric so the profile owner can fix or remove the test.

## Validation and dry run

`POST /projects/:id/repo-profile/validate` runs:
1. clone at base SHA;
2. create sandbox with the profile image;
3. run setup;
4. run verify;
5. return pass/fail, timings, logs and cache hit/miss.

This is an admin operation, not model-driven.

## Data model

```sql
CREATE TABLE repo_profiles (
  id UUID PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INT NOT NULL,
  profile JSONB NOT NULL,
  status TEXT NOT NULL, -- draft, active, inactive
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version)
);
```

`profile.base_branch` is the most specific source. fg-36's `BaseBranchResolver` uses: active profile > project setting > GitHub repo default > `main`, then `master`. Do not duplicate this order elsewhere.

## Tests

- detect Node/Python/Java/Go/monorepo profiles;
- setup/verify success and failure;
- cache reuse and isolation;
- service startup/health/cleanup;
- flaky retry behavior;
- invalid profile validation;
- missing profile fallback warning.

## Rollout

1. Add the schema and a static profile for the planner repo.
2. Dry-run validation.
3. Use profiles for new tickets; fall back to autodetection for others.
4. Add caches and services.
5. Onboard real projects one by one.

## Open questions

1. Do we use devcontainers or custom images?
2. How do we sanitize cache writes from untrusted scripts?
3. Who owns profile updates: project admin or platform?
4. How do we handle repos with multiple languages/services?
5. What is the fallback when a service image is unavailable?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-34 | Sandbox images and supply chain | Security | `fg-34-harness-sandbox` | No |
| 2 | fg-37 | Profile reliability metrics | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 3 | fg-38 | Cache-aware budgets | Billing | `fg-38-harness-budgets-routing` | No |
| 4 | fg-41 | Setup/verify telemetry | Observability | `fg-41-harness-observability` | No |
