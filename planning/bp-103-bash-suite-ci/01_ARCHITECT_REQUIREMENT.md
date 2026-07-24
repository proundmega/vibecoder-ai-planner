# 01_ARCHITECT_REQUIREMENT.md — CI Integration for Bash Integration Suite

**Status**: planned
**Date created**: 2025-07-24
**Date completed**: 
**Author**: AI Assistant
**Scope**: CI/CD
**Priority**: P2 (Testing)
**Effort**: Small

---

## Requirement

The bash integration test suite (`backend/integration-test/run.sh`) provides real API coverage but is only run locally. The CI Jenkinsfile's "Integration Tests" stage runs Jest integration tests inside the test container but does NOT run the bash suite. This means API contract violations between Jest mock tests and real HTTP responses go undetected.

---

## Existing Infrastructure Audit

### CI Check
- [x] Jenkinsfile: `Jenkinsfile:213-300` — "Integration Tests" stage runs Jest inside test container
- [x] Jenkinsfile: `Jenkinsfile:288-296` — Bash suite is NOT called in CI
- [x] Test container: `docker-compose.test.yml` — has jq, bash, curl available
- [x] Bash suite: `backend/integration-test/run.sh` — supports `--only` flag (skip docker compose)
- [x] Bash suite: `backend/integration-test/run.sh:134-139` — auto-discovers suites from `suites/*.test.sh`

### Key Insight

The bash suite already supports `--only` flag which skips Docker setup and assumes services are running. The test container already has the API service running. We just need to add one `docker exec` step to run the bash suite after Jest tests.

---

## Scope

### In Scope
- Add bash integration suite step to Jenkinsfile "Integration Tests" stage
- Run bash suite inside test container with `BASE_URL=http://api:3001 bash integration-test/run.sh --only`
- Capture and report failures (exit code propagation)

### Out of Scope
- Adding new bash test suites (already 26 suites)
- Container image changes (jq, bash, curl already available)
- Parallel execution of Jest + bash suites (sequential is fine for current scale)
- Test report artifacts (Jenkins can handle this separately)

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `Jenkinsfile` | MODIFY | Add bash suite step in "Integration Tests" stage |

---

## Acceptance Criteria

1. [ ] Jenkinsfile runs bash suite after Jest integration tests
2. [ ] Bash suite runs inside test container (`vibecode-test`)
3. [ ] `BASE_URL=http://api:3001` for intra-container communication
4. [ ] `--only` flag used (skip docker compose setup)
5. [ ] Bash suite failures cause CI build to fail
6. [ ] Local execution unchanged (`bash integration-test/run.sh` works as before)

---

## Out of Scope

- Adding new bash test suites
- Container image changes
- Parallel execution
- Test report artifacts

---

## Performance Considerations

- Bash suite adds ~30-60s to CI pipeline (26 suites × API calls)
- Acceptable — current CI timeout is 60 minutes
- Sequential execution (Jest → bash) is simpler and avoids race conditions

---

## Testing Checklist

### CI Verification
- [ ] Jenkinsfile syntax is valid (groovy lint)
- [ ] Bash suite runs and exits 0 on success
- [ ] Bash suite exits non-zero on failure

---

*Fill in all sections before starting implementation.*
