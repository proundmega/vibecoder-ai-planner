# 04_SPECIFICATION.md — Bash Suite CI Integration Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## File Operations

### MODIFY: `Jenkinsfile`

**Find** the section that runs Jest integration tests (around line 277-285):

```groovy
sh '''
    docker exec -w /app vibecode-test bash -c '
        OUTPUT=$(./node_modules/.bin/jest --config jest.integration.config.js --verbose 2>&1)
        echo "$OUTPUT"
        if echo "$OUTPUT" | grep -E "^(Test Suites:|Tests:)" | grep -qi "failed"; then
            exit 1
        fi
    '
'''
```

**Add immediately after this block** (before the closing `}` of the `script` block):

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

**Key details**:
- `BASE_URL=http://api:3001` — Docker network hostname for the API service
- `--only` — skips Docker compose setup (infra already running)
- `exit $EXIT_CODE` — ensures Jenkins sees failures
- `set -x` — enables debug output in bash for troubleshooting
- `2>&1` — captures stderr for Jenkins log visibility

---

## Test Expectations

### CI Verification
```
✓ [happy] Bash suite runs in CI after Jest tests
✓ [happy] Bash suite exits 0 when all 26 suites pass
✓ [edge] Bash suite exits non-zero when a suite fails
✓ [edge] BASE_URL=http://api:3001 resolves inside test container
✓ [shape] Jenkins log shows "--- bash test exit code: N ---"
```

---

## Edge Cases to Handle

1. **[DNS resolution]**: The `api` hostname is resolvable inside the test container because Docker Compose creates a default network where all services can reach each other by name.
2. **[Rate limiting]**: `run.sh:64` sets `INTEGRATION_TESTS=1` which disables rate limiting. No additional config needed.
3. **[jq availability]**: `docker-compose.test.yml` installs jq in the test container. No changes needed.

---

## Existing Code Patterns to Follow

- Jenkinsfile uses `sh '''...'''` for multi-line shell commands
- Docker exec uses `-w /app` to set working directory
- Exit codes are captured and checked
- Output is echoed for Jenkins log visibility

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `backend/integration-test/run.sh` — already supports `--only` flag
- `docker-compose.test.yml` — test container already has jq, bash, curl
- `backend/integration-test/suites/` — all 26 suites already exist

---

*This specification is the contract between planning and execution.*
