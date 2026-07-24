# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: CI/CD

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `Jenkinsfile` — Integration Tests stage runs Jest + bash suite in test container
- [ ] I have verified `docker-compose.test.yml` — test service with jq, bash, curl
- [ ] I have verified `backend/integration-test/run.sh` — works with `--only` flag
- [ ] I have checked that bash suite runs inside the test container (not on host)

### Testing Strategy

- [ ] Verify bash suite runs in CI with `--only` flag
- [ ] Verify jq is available in test container
- [ ] Verify exit codes propagate correctly

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] Jenkinsfile updated with bash suite step
- [ ] Bash suite runs after Jest integration tests in CI
- [ ] Failures in bash suite cause build to fail
- [ ] No changes to local test execution (`bash integration-test/run.sh`)

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
