# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-11-02
**Date completed**: —
**Author**: AI Assistant
**Scope**: Backend + Agent (test-only)
**Priority**: P1
**Effort**: Medium
**Related**: fg-33 (durable harness execution), fg-30 Phase 1 (harness supervisor), PR #110 (slice 1)

---

## Requirement

fg-33 slice 1 adds durable harness runs, checkpoints and leases. The current coverage is split across layers:

- `ApiServiceHarnessTest` tests the Java HTTP client against a local stub server.
- `api-harness-runs.test.js` tests the Express routes with `HarnessRunService` mocked.
- `harnessRuns.test.js` tests `HarnessRunService` against real Postgres.
- `HarnessTicketProcessorTest` tests the Java supervisor with `ApiService` mocked.

No test exercises the complete composition **real Java agent/HTTP client → real `/api/v1/harness` routes → real Postgres**, and no disposable staging run has validated the real OpenCode/GitHub/PR path. A path/body/auth mismatch, project-scope bug, or finish-failure bug can therefore pass every mocked/split test.

This ticket adds an end-to-end validation suite and a disposable staging runbook. It is a **test/validation ticket**: no production behavior changes are expected.

The ticket is phased so it can start immediately after fg-33 slice 1:

- **Phase A (this ticket, after slice 1):** real HTTP/Postgres backend e2e, agent contract/processor gap check, manual happy-path staging run, and failure cases that slice 1 supports.
- **Phase B (after fg-33 slice 2):** crash/restart recovery, resume, scheduled reaper + ticket release, and idempotent publish failure cases; optional CI Docker e2e.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/harnessRuns.js` — YES
- [x] Route mounted: `backend/src/api/v1/index.js` → `/api/v1/harness` — YES
- [x] Controller layer: routes call the service directly (no separate controller) — YES, existing pattern
- [x] Service exists: `backend/src/services/HarnessRunService.js` — YES
- [x] Model: raw SQL through `pool` — YES, existing pattern
- [x] Validator: service-level validation (no Joi middleware on harness routes) — YES, existing pattern
- [x] Migration: `045_harness_runs.sql` + `_rollback.sql` — YES
- [x] OpenAPI JSDoc annotations: none on harness routes — NO (not required for this test ticket)

### Frontend API Client Check
- [x] Frontend API client: N/A (agent/operator API only)
- [x] Frontend UI: N/A

### Agent / Test Infrastructure Check
- [x] Agent HTTP client tests: `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java` — YES (PR #110)
- [x] Agent lifecycle tests: `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` — YES
- [x] Backend service/Postgres integration: `backend/src/__tests__/integration/harnessRuns.test.js` — YES
- [x] Backend route tests with mocked service: `backend/src/__tests__/api-harness-runs.test.js` — YES
- [x] Bash integration runner: `backend/integration-test/run.sh` — YES; no harness-specific suite
- [x] Full agent → HTTP → Postgres e2e: NO
- [x] Disposable staging/test-ticket runbook: NO

### Key Insight

This is a **test-only** ticket. The production implementation and its split-layer tests already exist in fg-33 slice 1. The missing coverage is the **composition** and the **real staging path**:

1. Backend route → service → Postgres, with a real agent API key and real JWT operator tokens.
2. Java HTTP client → those real route names and response shapes (the client contract test uses a stub server).
3. The supervisor process → real backend → real Postgres → OpenCode/provider → Git/PR.
4. Failure behavior after a publish (finish endpoint unavailable, key expiry, lease loss, crash, reaper).

The automated backend e2e should run in CI. The real-OpenCode/GitHub run is a disposable manual smoke test because it needs credentials, a test repository and a provider; it must not use a production ticket.

---

## Scope

### In Scope

- Create `backend/src/__tests__/integration/harnessE2EFixtures.js` — disposable test owner/project/agent/ticket fixtures with cleanup.
- Create `backend/src/__tests__/integration/harnessHttpE2E.test.js` — real app + real Postgres via `supertest`:
  - start/claim/checkpoints/heartbeat/finish through the actual routes;
  - DB assertions for `harness_runs`, `harness_checkpoints`, `harness_leases`;
  - auth/ownership/project-scope/role checks;
  - duplicate-start/lease-conflict/checkpoint-order/idempotent-finish behavior.
- Extend `ApiServiceHarnessTest` and/or `HarnessTicketProcessorTest` only if a concrete gap is found while planning the manual run; do not duplicate existing coverage.
- Add a **manual staging runbook** in `03_ARCHITECT_IMPLEMENTATION.md`:
  - dedicated test project/repo/ticket/agent;
  - `HARNESS_DURABILITY_REQUIRED=true`;
  - short lease/heartbeat and a small wall-clock budget;
  - the happy-path DB/PR assertions;
  - failure cases supported by slice 1;
  - explicit slice 2 cases and cleanup steps.
- Update `PENDING.txt` and `planning/HARNESS_ROADMAP.md` to index this ticket.

### Out of Scope

- Any production code change (unless a test-only seam is unavoidable; prefer no change).
- Implementing fg-33 slice 2 (startup recovery, resume, scheduled reaper, ticket release, idempotent publish).
- A fully containerized real-agent e2e in CI (deferred to a follow-up; the manual staging run is the Phase A acceptance).
- Using a production ticket, production repository, production PR or production data.
- Frontend UI for run state.
- fg-34 sandbox, fg-41 observability, fg-42 privacy implementation.

---

## Pending Scope Items to Present to User

**MANDATORY**: The following deferred items are relevant to this ticket's domain and must remain visible before scheduling/implementation.

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | fg-33 | Agent startup recovery (`AgentApp` using `listActiveRunsForAgent`) | Reliability | fg-33 slice 2 | ☐ |
| 2 | fg-33 | Resume/restart policy per checkpoint (`HARNESS_RESUME_MODE`) | Reliability | fg-33 slice 2 | ☐ |
| 3 | fg-33 | Scheduled reaper wiring + ticket release; release only when `run_failed=true`, ticket still `in_progress`, no `pr_url` | Reliability | fg-33 slice 2 | ☐ |
| 4 | fg-33 | Idempotent publish: branch/PR detection, duplicate-PR prevention, `head_sha`/`pr_url` storage | Reliability | fg-33 slice 2 | ☐ |
| 5 | fg-33 | Workspace registry and orphan/retention cleanup | Storage | fg-33 / fg-44 | ☐ |
| 6 | fg-33 | Crash-injection tests, metrics, alerts, manual recovery runbook | Testing / Observability | fg-33 / fg-41 | ☐ |
| 7 | fg-33 | Dead-letter/adoption flow for operators | Operations | fg-33 | ☐ |
| 8 | fg-34 | Sandbox isolation for the real staging agent (read-only rootfs, egress, secretless execution) | Security | fg-34 | ☐ |
| 9 | fg-41 | Run correlation/events and dashboards for e2e evidence | Observability | fg-41 | ☐ |
| 10 | fg-42 | Redaction/retention for captured test artifacts | Privacy | fg-42 | ☐ |
| 11 | bt-60 | Fully containerized real-agent e2e in CI | Testing | follow-up after slice 2 | ☐ |
| 12 | bt-60 | Automated fault injection for `/finish`, lease loss, key expiry, crash/restart | Testing | Phase B / slice 2 | ☐ |

**All items above must be presented to the user before ticket approval. Phase A does not require slice 2, but the full failure matrix does.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | fg-33 | Startup recovery, resume, scheduled reaper + ticket release, idempotent publish, workspace retention, crash injection/metrics | Reliability | fg-33 slice 2 |
| 2 | fg-34 | Sandboxed real staging agent | Security | fg-34 |
| 3 | bt-60 | Containerized CI e2e and automated fault injection | Testing | follow-up after slice 2 |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/integration/harnessE2EFixtures.js` | CREATE | Test owner/project/agent/ticket setup + cleanup |
| `backend/src/__tests__/integration/harnessHttpE2E.test.js` | CREATE | Real app + Postgres HTTP/DB e2e |
| `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java` | EXTEND (only if gap) | Client contract gaps found during planning |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` | EXTEND (only if gap) | Processor failure cases found during planning |
| `planning/bt-60-durable-harness-e2e-tests/03_ARCHITECT_IMPLEMENTATION.md` | MODIFY | Add runbook/results as implementation proceeds |
| `PENDING.txt` | MODIFY | Backlog row for bt-60 |
| `planning/HARNESS_ROADMAP.md` | MODIFY | Index fg-33 validation ticket |
| Production source / migrations | NONE | Test-only |

---

## Known Unknowns

1. **Test repository and credentials**: Which dedicated test repo/provider/GitHub token will the staging run use? Resolve before the manual layer; never use production.
2. **Slice 2 timing**: Startup recovery/resume/scheduled reaper/idempotent publish must land before the Phase B failure matrix can pass. Confirm whether the ticket is split or kept open across slice 2.
3. **Fault injection for `/finish`**: The current backend has no test-only finish-failure switch. The manual layer can use a proxy/controlled outage, or Phase B can add a test-only seam. Decide without production impact.
4. **CI Docker e2e cost**: A real-agent containerized e2e needs provider/GitHub secrets and a test repo; likely a follow-up, not Phase A.
5. **Agent test DB isolation**: The integration setup applies migrations to the configured database; fixtures must use unique suffixes and cleanup. Confirm the CI database is disposable or cleanup is safe.
6. **Agent startup prerequisites**: The real agent requires `HARNESS_MODE=opencode`, an OpenCode binary, provider config, a test project ID and a test repo. Document exact values in the runbook without committing secrets.

---

## Important Design Decisions

1. **Test layers** — recommended: automated backend HTTP/Postgres e2e + existing agent client/processor tests + disposable manual staging run. A fully containerized CI e2e is a follow-up. This keeps CI deterministic while covering the real composition manually.
2. **Disposable test ticket** — use a dedicated test project/repo and throwaway ticket, never a normal product ticket. Slice 2 recovery/reaper is not available yet, so failures can leave a ticket stuck.
3. **Phase split** — Phase A covers happy path + slice-1 failure cases immediately after slice 1. Phase B covers crash/reaper/idempotent-publish cases after slice 2. This avoids blocking the e2e ticket on all of fg-33.
4. **No production changes** — if a test seam is needed for `/finish` failure or crash injection, prefer a test harness/proxy or add it in slice 2; do not ship test-only production switches.

**No design decisions require user input beyond confirming the test repository/credentials and the Phase A/Phase B split. All other choices follow existing test patterns.**

---

## Acceptance Criteria

1. [ ] `harnessE2EFixtures.js` creates a disposable owner/project/agent/ticket with a unique suffix and cleans up all rows.
2. [ ] `harnessHttpE2E.test.js` uses the real app and real Postgres, not mocked routes/service.
3. [ ] Start → claim → checkpoint sequence → heartbeat → finish is exercised through `/api/v1/harness` with an agent API key.
4. [ ] DB assertions cover `harness_runs` (status/step/attempt/head/pr), `harness_checkpoints` (order/context), and `harness_leases` (claim/renew/release).
5. [ ] Duplicate start returns 409/`CONFLICT` and leaves one active run.
6. [ ] Wrong-agent and JWT-user access are denied; project owner/member operator reads work; outside-project reads fail.
7. [ ] Ticket-assignment/start authorization is covered (wrong owner/status).
8. [ ] Checkpoints reject backwards steps; checkpoints after finish are rejected.
9. [ ] Finish is idempotent; the lease is released; a second finish returns the terminal state.
10. [ ] Manual staging happy path is executed with a disposable test project/repo/ticket/agent, asserting run/checkpoint/lease/ticket/PR state.
11. [ ] Finish failure after publish is attempted and the ticket is confirmed to stay `review` (no release/reset); if not automatable in Phase A, it is tested at the processor layer and documented as a manual Phase B case.
12. [ ] Key expiry/revoke and start 401 behavior are covered at the client/processor layer and in the runbook.
13. [ ] Crash/restart, scheduled reaper/ticket release, and idempotent publish are explicitly marked Phase B/slice 2; no false claim of coverage.
14. [ ] No production ticket/repo/data is used; cleanup is documented and tested.
15. [ ] Backend integration tests, backend unit tests, agent tests and lint pass.
16. [ ] `PENDING.txt` and `planning/HARNESS_ROADMAP.md` index the ticket.

---

## Out of Scope

- Production behavior changes and feature work.
- Slice 2 implementation (recovery, resume, scheduled reaper, ticket release, idempotent publish).
- A permanent staging environment.
- Committing test credentials or provider/GitHub secrets.
- Frontend run-state UI.
- Full sandbox/privacy/observability features (kg-34/41/42).

---

## Performance Considerations

- Backend HTTP e2e: one or two test users/projects/agents/tickets per run; cleanup; no large data volumes.
- Manual staging: one disposable ticket/PR; short wall-clock budget; provider/OpenCode/GitHub latency dominates.
- CI: the new integration test runs with `maxWorkers:1`; keep the suite small and deterministic.
- No N+1 or caching changes.

---

## Security Considerations

- [x] Authentication required: real agent API key for mutations; JWT for operator reads
- [x] Authorization check: ticket-assignment start, agent run ownership, operator role/project scope
- [x] Input validation: service-level validation already; e2e asserts 400/401/403/409
- [x] Rate limiting: not required for the test; existing app defaults
- [x] Sensitive data: use dedicated test agent/project/repo; never commit provider/GitHub keys; redact test artifacts
- [x] Test-only: no production ticket/PR/data

---

## Testing Checklist

### Test-First
- [ ] New test files/fixtures are created before any optional test seam
- [ ] No production code is added solely for the test unless approved

### Backend Tests
- [ ] `harnessHttpE2E.test.js` — real app + real Postgres
- [ ] Existing `harnessRuns.test.js` still passes
- [ ] Existing `api-harness-runs.test.js` still passes
- [ ] `npm test` and `npm run lint`

### Agent Tests
- [ ] `ApiServiceHarnessTest` still passes; extend only for a real gap
- [ ] `HarnessTicketProcessorTest` still passes; extend only for a real gap
- [ ] `mvn test`

### Manual Staging
- [ ] Disposable test project/repo/ticket/agent created
- [ ] Happy path exercised and DB/PR assertions recorded
- [ ] Finish-down/key-expiry/lease-loss failure cases attempted where supported
- [ ] Slice 2 cases explicitly listed as deferred
- [ ] Cleanup performed

### CI
- [ ] `jest.integration.config.js` picks up `harnessHttpE2E.test.js`
- [ ] Full backend integration suite passes
- [ ] Agent `mvn test` passes

---

## Anti-Patterns to Avoid

- ❌ Treating the split-layer tests as a full e2e.
- ❌ Using a normal product ticket/repo for the staging run.
- ❌ Claiming crash/reaper/idempotent-publish coverage before slice 2 lands.
- ❌ Committing real provider/GitHub/agent credentials.
- ❌ Adding production-only fault switches for tests.
- ❌ Leaving test users/projects/tickets/runs behind after a failed run.

---

*Fill in all sections before starting implementation.*
