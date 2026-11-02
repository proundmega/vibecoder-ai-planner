# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-11-02
**Date completed**: —
**Author**: AI Assistant
**Feature scope**: Backend + Agent (test-only)

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below.

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — requirement, scope and acceptance criteria are understood
- [x] I have read `02_ARCHITECT_DESIGN.md` — test layers, alternatives and risks are understood
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — file actions, dependencies and test steps are understood
- [ ] I have read `04_SPECIFICATION.md` (if created at scheduling time) — exact test fixtures/signatures are understood
- [x] I have identified assumptions (test project/repo, test agent, disposable ticket, slice 2 timing)
- [x] I know what is IN scope (tests, fixtures, runbook) and OUT of scope (production changes, slice 2 implementation, real product data)
- [x] I have confirmed the test-only nature of this ticket; no production code changes are expected
- [ ] I have confirmed the manual staging prerequisites (test GitHub repo, provider key, test agent) with the user

### Existing Infrastructure Audit

- [x] Harness routes exist: `backend/src/api/harnessRuns.js`; mounted at `backend/src/api/v1/index.js` → `/api/v1/harness`
- [x] Harness service exists: `backend/src/services/HarnessRunService.js`
- [x] Migration exists: `backend/src/migrations/045_harness_runs.sql` + rollback
- [x] Service-level Postgres integration test exists: `backend/src/__tests__/integration/harnessRuns.test.js` (11 tests)
- [x] Route tests exist but mock the service: `backend/src/__tests__/api-harness-runs.test.js`
- [x] Java HTTP contract test exists: `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java`
- [x] Java processor lifecycle test exists: `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java`
- [x] Bash integration runner exists: `backend/integration-test/run.sh`; no harness-specific suite yet
- [x] No full agent → real HTTP routes → Postgres composition test exists
- [x] No disposable-ticket staging runbook exists

### Dependency Analysis

- [x] `fg-33` slice 1 (runs/checkpoints/leases, routes, agent lifecycle) is the implementation under test
- [x] `fg-33` slice 2 (startup recovery, resume, scheduled reaper + ticket release, idempotent publish) is required for the full failure matrix
- [x] Existing `ApiServiceHarnessTest` covers the HTTP client contract; existing `harnessRuns.test.js` covers service+DB
- [x] Manual staging requires a dedicated test project/repo, test agent, provider key and GitHub token
- [x] No new npm/system dependencies are required for the planned automated layers
- [x] No production migrations; test fixtures use the existing `harness_*` tables and cleanup
- [x] CI impact: the new backend HTTP e2e test is picked up by `jest.integration.config.js`; no Jenkinsfile change is required for the automated layer

### Configuration Audit

- [x] No new environment variables for the automated backend test
- [x] Manual runbook uses existing `HARNESS_*` vars; `HARNESS_DURABILITY_REQUIRED=true` is required for a meaningful staging run
- [x] Test credentials are not committed; the runbook references a dedicated test agent/project/repo

### Database & Migration

- [x] No new production migration
- [x] Test fixtures use unique suffixes and explicit cleanup (runs/leases/checkpoints cascade with tickets/agents)
- [x] Test data must never include production tickets or PRs

### Testing Strategy

- [x] Backend HTTP e2e: real Express app + real Postgres, using `supertest` and the agent API key
- [x] Agent HTTP contract: existing `ApiServiceHarnessTest`; extend only if a gap is found
- [x] Agent processor lifecycle: existing `HarnessTicketProcessorTest`; extend only if a gap is found
- [x] Manual staging: disposable test project/repo/ticket/agent through real OpenCode/GitHub/Postgres
- [x] Failure matrix: finish failure after publish, key expiry, duplicate start, lease loss, crash/restart (slice 2), reaper (slice 2), idempotent publish (slice 2)
- [x] Test-first: the new test files and fixtures are the first file operations; no production code is added
- [x] Cleanup: automated fixtures in `afterAll`; manual SQL/agent cleanup documented in `03_ARCHITECT_IMPLEMENTATION.md`
- [x] No coverage-threshold impact beyond the backend integration suite

### Implementation Readiness

- [x] Files to create vs. modify are identified
- [x] Existing test patterns are identified (`harnessRuns.test.js`, `ApiServiceHarnessTest`, `HarnessTicketProcessorTest`)
- [x] The test project/repo/ticket/agent workflow is documented
- [x] The branch name is not assigned yet; implementation starts after scheduling

## Post-Implementation Checklist

- [ ] Backend HTTP e2e test passes against Postgres (`npx jest --config jest.integration.config.js --runInBand src/__tests__/integration/harnessHttpE2E.test.js`)
- [ ] Existing backend integration suite still passes (`npx jest --config jest.integration.config.js --runInBand`)
- [ ] Agent tests pass (`cd agent && mvn test`)
- [ ] Backend unit tests pass (`cd backend && npm test`)
- [ ] Backend lint passes (`cd backend && npm run lint`)
- [ ] No production code files changed; only tests/docs/runbook
- [ ] Test fixtures clean up all created users/projects/agents/tickets/runs/leases/checkpoints
- [ ] Manual staging happy path completed with a disposable ticket and test repo
- [ ] Manual staging failure matrix attempted where slice 2 exists; remaining cases explicitly deferred
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` updated with Date completed / PR / Branch
- [ ] `PENDING.txt` and `planning/HARNESS_ROADMAP.md` reflect the completed status
- [ ] No production ticket, no production PR, no production data used

## When to Ask the User

1. **Test repository/credentials**: the manual staging run needs a dedicated test GitHub repo and a provider key; confirm the target.
2. **Slice 2 timing**: the crash/reaper/idempotent-publish cases cannot be completed until fg-33 slice 2 lands; confirm whether to split the ticket into Phase A (happy path) and Phase B (failure matrix).
3. **CI Docker e2e**: a fully containerized real-agent e2e is intentionally deferred; confirm if it should become a later ticket.
4. **Any production impact**: none expected; stop if implementation starts requiring production changes.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
