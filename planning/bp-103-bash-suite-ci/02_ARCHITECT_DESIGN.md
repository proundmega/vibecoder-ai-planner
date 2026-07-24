# 02_ARCHITECT_DESIGN.md — Bash Suite CI Integration Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: CI/CD
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Jenkinsfile "Integration Tests" stage runs Jest inside the test container but skips the bash suite. This means real HTTP API tests (26 suites) are not verified in CI.

---

## Design

### Current CI Flow (Jenkinsfile:213-300)

```
1. Build infra (docker compose)
2. Wait for API + PG to be ready
3. Start test container
4. Run Jest integration tests (inside test container)
5. ← BASH SUITE IS MISSING HERE
```

### Updated CI Flow

```
1. Build infra (docker compose)
2. Wait for API + PG to be ready
3. Start test container
4. Run Jest integration tests (inside test container)
5. Run bash integration suite (inside test container) ← NEW
6. Aggregate results
```

### Implementation

Add after the Jest test step (after line 285, before the bash suite section):

```groovy
// Run bash integration tests inside the test container
sh '''
    docker exec -w /app vibecode-test bash -c '
        set -x
        BASE_URL=http://api:3001 bash integration-test/run.sh --only 2>&1
        EXIT_CODE=$?
        echo "--- bash test exit code: $EXIT_CODE ---"
        exit $EXIT_CODE
    '
'''
```

### Why `BASE_URL=http://api:3001`?

Inside the Docker network, the API service is reachable as `api:3001` (Docker DNS). The `BASE_URL` env var is already used by `run.sh` (line 53: `BASE="${BASE_URL:-http://localhost:3001}"`).

### Why `--only`?

The `--only` flag (line 68-70) skips Docker compose setup since the test container already has the infra running.

---

## Risks and Edge Cases

- **[DNS resolution]**: `api` hostname must resolve inside the test container. Docker Compose creates a default network where service names are resolvable.
- **[Rate limiting]**: `INTEGRATION_TESTS=1` is set in `run.sh:64` which disables rate limiting for integration tests.
- **[Exit code propagation]**: The `exit $EXIT_CODE` in the `docker exec` command ensures Jenkins sees the failure.

---

## Alternative Designs Considered

### Alternative 1: Run bash suite on host (outside container)
- **Pros**: Easier debugging
- **Cons**: Requires jq on Jenkins host, slower (no Docker network between test and API)
- **Decision**: Run inside test container — jq is already available, network is direct

### Alternative 2: Merge Jest + bash into single step
- **Pros**: Simpler Jenkinsfile
- **Cons**: Harder to debug which layer failed (Jest vs bash)
- **Decision**: Keep separate steps with clear output separators

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
