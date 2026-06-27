# bp-42: Add Cypress E2E + Bash Integration Test Suite to CI Pipeline

**Status**: planned
**Date created**: 2026-06-27
**Scope**: CI
**Priority**: P1
**Effort**: Medium

## Problem Statement

The CI pipeline currently runs unit tests only. Two entire test suites — the bash integration suite (`backend/integration-test/run.sh`) and Cypress E2E tests (`frontend/cypress/e2e/`) — are never executed in CI. This means regressions in real database interactions and full-stack flows go undetected until manual testing.

## Scope

- **In scope**: Add a CI job/steps for bash integration tests, add a CI job/steps for Cypress E2E, modify `ci.yml`, add helper scripts where needed
- **Out of scope**: Adding new tests, fixing flaky tests, rewriting test infrastructure

## Acceptance Criteria

- [ ] Bash integration suite runs against real PostgreSQL in CI and passes (or reports failures cleanly)
- [ ] Cypress E2E suite runs in headless mode against a real backend + seeded DB in CI and passes
- [ ] CI pipeline summary shows integration + E2E results clearly
- [ ] Pipeline does not exceed 15 minutes total wall-clock time
- [ ] No hardcoded secrets in CI config — use GitHub Actions secrets or service containers

## Known Unknowns

- **Docker-in-CI**: Whether Docker Compose works in GitHub Actions runners without `docker compose` plugin preinstalled
- **Seed data**: Cypress E2E tests need seeded data; how to run the seed script in CI?
- **Artifact retention**: Whether Cypress screenshots/videos and integration test logs should be stored as artifacts

## Decisions Required

1. **Separate job or steps within existing jobs?**
   - Option A: New "integration" and "e2e" jobs (parallel, clearer failure isolation)
   - Option B: Add steps to backend and frontend jobs (simpler config, fewer runners)
   - **Recommendation**: Option A — independence reduces flakiness from shared state

2. **How to provide PostgreSQL for integration tests?**
   - Option A: GitHub Actions PostgreSQL service container
   - Option B: Docker Compose with a PG service
   - **Recommendation**: Option A — native GA support, no Docker Compose overhead

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `.github/workflows/ci.yml` | MODIFY | Add integration and e2e jobs |
| `backend/integration-test/run.sh` | MODIFY | Accept PG connection params via env vars |
| `frontend/package.json` | MODIFY | Add `cypress:ci` script |

## Dependencies

- **Depends on this**: bp-43 (refactor tests) — run after test files are cleaned up
- **Depends on this**: bp-46 (fill test gaps) — E2E tests need seed command to work

## Performance Considerations

- Integration tests hit real PG — add `maxWorkers: 1` to prevent connection pool exhaustion
- Cypress E2E starts Vite preview server — takes ~30s for cold start; use `--preview` to reuse build
