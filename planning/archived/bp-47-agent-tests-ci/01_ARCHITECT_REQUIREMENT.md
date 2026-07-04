# bp-47: Add Java Agent Tests to CI Pipeline

**Status**: planned
**Date created**: 2026-06-27
**Scope**: CI / Agent
**Priority**: P2
**Effort**: Small

## Problem Statement

The Java agent (`agent/`) has a `pom.xml` with JUnit 5 + Mockito test dependencies and existing test files, but they are never executed in CI. Agent changes can break compilation or test assertions without detection until manual testing.

## Scope

- **In scope**: Add a CI job that runs `mvn test` in `agent/`, verify Surefire plugin is configured, add JDK 17 setup
- **Out of scope**: Writing new agent tests, fixing existing broken tests, adding integration tests for the agent

## Acceptance Criteria

- [ ] CI pipeline has a job named `agent` that runs `mvn test`
- [ ] JDK 17 is installed via `actions/setup-java@v4`
- [ ] Agent tests run independently (no Docker, no DB, no network)
- [ ] Pipeline fails if agent compilation or tests fail
- [ ] Agent job completes within 3 minutes

## Known Unknowns

- **Maven wrapper**: Whether agent/ has `mvnw` or needs system Maven
- **Cache**: Whether Maven dependency cache is configured for faster builds

## Decisions Required

1. **Separate job or step in backend job?**
   - Option A: New `agent` job (independent, parallel with backend/frontend)
   - Option B: Step in backend job (fewer runners)
   - **Recommendation**: Option A — Java has different tooling (JDK, Maven)

2. **Maven wrapper vs system Maven?**
   - Option A: Use `mvnw` from agent directory
   - Option B: Use system Maven via setup-java (it includes Maven)
   - **Recommendation**: Option B — setup-java provides Maven; no need for wrapper

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `.github/workflows/ci.yml` | MODIFY | Add `agent` job |
| `agent/pom.xml` | VERIFY | Ensure surefire plugin is configured (likely already is) |
