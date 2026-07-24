# 03_ARCHITECT_IMPLEMENTATION.md — Bash Suite CI Integration Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: CI/CD
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation

### MODIFY: `Jenkinsfile`

**Location**: "Integration Tests" stage, after the Jest integration test step (after line 285).

**Add** the bash suite execution step:

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

**Position**: After the Jest integration test step (lines 277-285) and before the closing `'''` and `}`.

---

## Files Changed

```
Jenkinsfile  → MODIFY (add bash suite step in Integration Tests stage)
```

---

### i) Code Review Checklist

- [ ] Bash suite step is inside the "Integration Tests" stage
- [ ] `BASE_URL=http://api:3001` for intra-container Docker network
- [ ] `--only` flag used (no docker compose setup)
- [ ] Exit code is captured and propagated (`exit $EXIT_CODE`)
- [ ] Output is echoed (`2>&1`) for Jenkins log visibility
- [ ] No changes to local test execution

### j) Post-Deploy Verification

1. [ ] Jenkinsfile syntax is valid
2. [ ] Bash suite runs in CI after Jest tests
3. [ ] Bash suite failures cause build to fail
4. [ ] Local execution unchanged (`bash integration-test/run.sh`)

---

*Fill in all sections before starting implementation.*
