# 03 — Implementation (bt-60)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Purpose

Prove the durable harness works as a composition, not only as isolated layers. The ticket adds:

1. A real Express app + real Postgres HTTP/DB e2e covering `/api/v1/harness`.
2. A disposable staging runbook for the complete Java agent → real routes → Postgres → OpenCode → GitHub PR path.
3. A failure matrix for finish failure, key expiry, lease loss and the slice 2 crash/reaper/idempotent-publish cases.

This is a test-only ticket. Do not modify production behavior.

---

## Plan

**CRITICAL**: Check whether existing tests already cover a case before adding a new file. Do not duplicate `ApiServiceHarnessTest` or `harnessRuns.test.js` assertions.

#### Implementation Order

1. **Fixture helper** — `backend/src/__tests__/integration/harnessE2EFixtures.js`
   - Create disposable owner/project/agent/ticket(s) with unique suffix.
   - Create a second owner/project/agent/ticket for cross-tenant tests.
   - Expose cleanup; use the real `pool`.
   - *Depends on*: nothing.

2. **Backend HTTP/Postgres e2e** — `backend/src/__tests__/integration/harnessHttpE2E.test.js`
   - Use `supertest(app)` against the real app; no service mocks.
   - Exercise start/claim/checkpoints/heartbeat/finish and DB assertions.
   - Cover auth, ticket assignment, duplicate start, lease conflict, step ordering, finish idempotency and operator read scope.
   - Cleanup in `afterAll`.
   - *Depends on*: Step 1.

3. **Agent gap check** — existing `ApiServiceHarnessTest` / `HarnessTicketProcessorTest`
   - Verify start 401/403/409, finish failure, lease loss and checkpoint/heartbeat RunGone are covered.
   - Extend only for a concrete missing case found while writing the HTTP e2e/runbook.
   - *Depends on*: Steps 1-2.

4. **Manual staging runbook** — this document, section (g)
   - Dedicated test project/repo/ticket/agent.
   - Happy path + slice-1 failure cases + explicit slice 2 deferrals.
   - Record results and cleanup.
   - *Depends on*: Steps 1-3 for the automated checks; manual prerequisites (test repo/credentials).

5. **Backlog/roadmap updates** — `PENDING.txt`, `planning/HARNESS_ROADMAP.md`
   - Add/keep the bt-60 row and dependency on fg-33; update status after implementation.
   - *Depends on*: nothing.

#### Phase 1: Backend Test Fixtures

Create `harnessE2EFixtures.js` following existing integration-test patterns:

- Use `new Pool({ connectionString: process.env.DATABASE_URL })` or the shared pool from the integration setup; do not use the application singleton in a way that leaks connections.
- Unique suffix: `${Date.now()}_${Math.floor(Math.random() * 1e6)}`.
- Create:
  - owner user (`role='project_admin'`) and other owner;
  - project owned by each;
  - agent for each owner with a real bcrypt-hashed API key (inspect `AgentService.getAgentByApiKey`, migration `033_add_api_key_expiry_to_agents.sql`, and the `agents` columns before implementing);
  - ticket assigned to the owner, `status='in_progress'` for the happy path;
  - optional `backlog`/review tickets for authorization tests.
- Return IDs and the plaintext test API keys (never real keys).
- Cleanup:
  - delete test users/projects/agents/tickets by IDs;
  - rely on `ON DELETE CASCADE` for harness runs/checkpoints/leases;
  - if a failed test leaves rows, run the cleanup SQL in section (g).
- Never use existing product rows.

#### Phase 2: Backend HTTP/Postgres E2E

Create `harnessHttpE2E.test.js` using `supertest` and the real app. Do not mock `HarnessRunService`.

Required cases (details in section (f)):

- Start: happy 201; DB row; assigned ticket; duplicate 409; wrong owner/status 403; JWT 403; missing/invalid auth 401.
- Lease: claim 201; second claim 409; renew/release; released/reassigned ticket renewal 409.
- Checkpoints: forward sequence; context columns; backward 409; unknown 400; after finish 404.
- Heartbeat: 200; `agent_step`; wrong agent/after finish 404.
- Finish: 200; status/head/pr; lease deleted; idempotent second finish; wrong agent 403.
- Reads: project owner/member JWT 200; user/outside 403; super_admin 200; agent own run 200, other agent 403.
- Cleanup: no residual test rows.

Use `jest.integration.config.js` and the existing `src/__tests__/integration/setup.js`; the test file is discovered by `**/integration/**/*.test.js`.

#### Phase 3: Agent Gap Check

Do not duplicate existing coverage. Confirm:

- `ApiServiceHarnessTest` covers real client paths/bodies/auth and 401/409/500 classification.
- `HarnessTicketProcessorTest` covers:
  - start 409/403 fatal → no clone;
  - lease claim error after run creation → fail closed;
  - checkpoint/heartbeat RunGone → no publish;
  - lease expiry before publish → no push/PR;
  - finish failure after successful publish → no release/reset; succeeded finish error-free;
  - normal failure finish failure → deferred release/backoff.
- Add a test only if a concrete gap remains. If adding, keep it in the same test classes and use existing mocks.

#### Phase 4: Manual Staging Runbook and Failure Matrix

Follow section (g). Use a dedicated test project/repository and a throwaway ticket. Phase A must execute the happy path and the slice-1 failure cases that can be reproduced without slice 2. Mark crash/reaper/idempotent-publish as Phase B/slice 2.

#### Phase 5: Documentation

- Update `03_ARCHITECT_IMPLEMENTATION.md` with Date completed, PR, Branch, results, residual rows and manual run evidence.
- Update `PENDING.txt` status.
- Update `planning/HARNESS_ROADMAP.md` status/validation line.
- If a test-only seam or new env var is introduced (avoid), document it and get approval.

---

## Per-file changes

#### `backend/src/__tests__/integration/harnessE2EFixtures.js` (CREATE)

- **Exports**:
  - `createHarnessFixture()` → `{ ownerId, projectId, agentId, agentApiKey, ticketId, ticketIds, otherOwnerId, otherProjectId, otherAgentId, otherAgentApiKey, otherTicketId, cleanup }`
  - `cleanupHarnessFixture(fixture)` → deletes users/projects/agents/tickets by ID; idempotent.
- **Patterns**:
  - Follow `backend/src/__tests__/integration/harnessRuns.test.js` fixture style.
  - Use `bcrypt.hashSync` for the agent key; inspect `AgentService.getAgentByApiKey` first.
  - Use `RETURNING id` and parameterized SQL.
- **Do not** delete unrelated rows; filter by IDs/suffix.
- **Cleanup** in `try/finally` or `afterAll`; log IDs on failure for manual cleanup.

#### `backend/src/__tests__/integration/harnessHttpE2E.test.js` (CREATE)

- **Imports**:
  - `supertest`, `../index` (app), `jsonwebtoken`/`getSecret` if needed, fixtures helper.
  - Real `pool` only for assertions/cleanup; not for service mocks.
- **Tests**:
  - `describe('harness HTTP e2e')` with `beforeAll` fixture and `afterAll` cleanup.
  - Use `request(app).post('/api/v1/harness/runs').set('X-API-Key', fixture.agentApiKey)`.
  - Assert `/harness/runs`, `/leases`, `/checkpoints`, `/heartbeat`, `/finish`.
  - DB assertions via `pool.query('SELECT ... FROM harness_runs WHERE id=$1')`.
  - JWT tokens signed with the test secret; roles `project_admin`, `member`, `user`, `super_admin`; project membership setup.
- **Patterns**:
  - Follow `api-harness-runs.test.js` for route names/status expectations.
  - Follow `harnessRuns.test.js` for DB setup/cleanup.
  - Use `expect(res.statusCode)` and `expect(res.body.success)` consistent with existing tests.

#### `agent/src/test/java/.../ApiServiceHarnessTest.java` / `HarnessTicketProcessorTest.java` (EXTEND only if gap)

- Do not duplicate existing cases.
- If a gap is found, add a test with the existing `HttpServer`/Mockito patterns.
- Keep tests in the same package/classes.

#### `03_ARCHITECT_IMPLEMENTATION.md` (MODIFY)

- Add run results, residual rows, PR/branch/status after implementation.
- Keep the runbook in section (g); update exact config values used.

#### `PENDING.txt` / `planning/HARNESS_ROADMAP.md` (MODIFY)

- Add/update bt-60 row.
- Dependencies: fg-33 slice 1 (happy path) and slice 2 (failure matrix).
- Status: planned → in_progress → completed.

---

## Dependencies

- fg-33 slice 1 implementation and migration.
- Postgres from `docker compose`/integration config.
- Existing split-layer tests.
- Test project/repo/agent and provider/GitHub credentials for the manual stage.
- Slice 2 for Phase B cases.
- No production code changes.

---

## Risks & edge cases

1. **Slice 2 missing** — do not mark Phase B cases as passed; mark deferred with the exact reason.
2. **Agent key fixture** — the real auth path requires the bcrypt hash columns; inspect `AgentService.getAgentByApiKey` and migration 033. Do not use a `test-` mock key for the real e2e unless the test explicitly wants the mock path.
3. **JWT project scope** — the operator route requires `OPERATOR_ROLES` (super_admin/project_admin/member) plus `AGENT_READ` and project owner/member; the `user` role must be denied. Set up project membership accordingly.
4. **Finish failure reproduction** — no production switch. Use the processor unit test for Phase A; use a proxy/controlled outage in the manual stage or add a test-only seam only with approval.
5. **Test DB cleanup** — unique suffix; cleanup in `afterAll`; manual SQL if a failure leaves rows.
6. **Real provider/OpenCode/GitHub** — flaky/credentialed; use a trivial ticket/change and a dedicated test repo; never production.
7. **CI cost** — backend HTTP e2e is lightweight; full containerized e2e deferred.
8. **Concurrent test execution** — integration config `maxWorkers:1`; still use unique suffixes.

---

## Verification matrix

| ID | Scenario | Layer | Expected | Phase |
|---|---|---|---|---|
| E1 | Agent starts a run for its assigned `in_progress` ticket | Backend HTTP | 201; run `running/created`; attempt 1 | A |
| E2 | Duplicate start while run active | Backend HTTP | 409 CONFLICT; one active run | A |
| E3 | Wrong agent/owner or wrong ticket status | Backend HTTP | 403; no run | A |
| E4 | JWT mutation | Backend HTTP | 403 | A |
| E5 | Start with invalid/expired agent key | Client/processor + route | 401; fatal; no publish | A |
| E6 | Claim lease and block another run | Backend HTTP | 201; second claim 409 | A |
| E7 | Renew/release lease | Backend HTTP | 200/200; missing 404 | A |
| E8 | Checkpoint sequence and context columns | Backend HTTP | 201 each; `workspace_path`/`session_id`/`base_sha` populated | A |
| E9 | Backward/unknown checkpoint | Backend HTTP | 409/400 | A |
| E10 | Checkpoint after finish | Backend HTTP | 404 | A |
| E11 | Heartbeat updates `agent_step`/`heartbeat_at` | Backend HTTP | 200; wrong agent/after finish 404 | A |
| E12 | Finish succeeded; lease deleted | Backend HTTP | 200; status/head/pr; no lease | A |
| E13 | Idempotent finish | Backend HTTP | 200 existing terminal; no duplicate side effect | A |
| E14 | Operator project scope/roles | Backend HTTP | owner/member 200; user/outside 403; super_admin 200 | A |
| E15 | Manual real happy path | Manual staging | run/checkpoints/lease/ticket/PR as expected | A |
| E16 | Finish endpoint unavailable after PR | Processor/manual | ticket stays `review`; no reset; run recoverable | A/B |
| E17 | Key expired/revoked mid-run | Processor/manual | fatal; no push/PR | A |
| E18 | Lease lost/expired before publish | Processor/manual | no push/PR; ticket left for recovery | A |
| E19 | Crash/restart mid-prompt/verify/publish | Manual | slice 2 recovery; manual cleanup until then | B |
| E20 | Reaper fails stale run and ticket release | Manual/backend | release only `in_progress`, no `pr_url`; not review/done | B |
| E21 | Idempotent publish/duplicate PR | Manual | one branch/PR; no duplicate | B |
| E22 | Full containerized CI e2e | CI Docker | deterministic happy path + failure cases | B/follow-up |

---


#### Existing Agent Tests

- `ApiServiceHarnessTest` — paths/body/auth/error classification.
- `HarnessTicketProcessorTest` — run persistence, fatal start, lease loss, finish retry/failure, checkpoint/heartbeat RunGone.

#### Manual Staging

- Happy path DB/PR/ticket assertions (section g).
- Finish-down, key-expiry, lease-loss cases where supported.
- Crash/reaper/idempotent-publish explicitly deferred to slice 2.

#### Commands

```bash
cd backend
npx jest --config jest.integration.config.js --runInBand src/__tests__/integration/harnessHttpE2E.test.js
npx jest --config jest.integration.config.js --runInBand
npm test
npm run lint

cd ../agent
mvn test
```

Manual staging: see section (g).

---

## Manual staging runbook

Use a dedicated **test project/repository** and a **throwaway ticket**. Never use a product ticket.

#### Prerequisites

- Test project + test GitHub repo (or a local bare repo if supported by the test setup).
- Test agent with provider/OpenCode/GitHub configuration.
- Provider key and test GitHub token (not committed).
- Postgres/backend running; agent can reach the backend.
- `HARNESS_MODE=opencode`
- `HARNESS_DURABILITY_REQUIRED=true`
- `HARNESS_LEASE_SECONDS=60`
- `HARNESS_HEARTBEAT_SECONDS=10`
- `HARNESS_MAX_DURATION_MINUTES=5`
- `HARNESS_VERIFY_COMMANDS=<fast, safe command>`
- A trivial ticket change (one file/line) in the test repo.

#### Happy path

1. Create the test project/repo/ticket; record `project_id`, `ticket_id`, `agent_id`.
2. Ensure the ticket is `backlog` and the agent is polling the test project.
3. Start the agent; let it pick up the ticket.
4. Observe `harness_runs`/`harness_checkpoints`/`harness_leases` and the ticket/PR.
5. Assert:
   - one run, `status=succeeded`, `step=done`, branch/base/head/pr populated;
   - checkpoints `cloned → session_ready → prompting → verifying → publishing → done`;
   - no lease row after finish;
   - ticket `review` with `pr_url`; agent heartbeat cleared;
   - exactly one test PR/branch.
6. Record the evidence (run ID, PR URL) without secrets.

#### Failure cases (Phase A where supported)

- **Finish unavailable after PR**: use a proxy/controlled outage; assert the ticket stays `review`, the run is recoverable, and the processor does not release/reset the ticket. If this cannot be reproduced without production changes, rely on `successFinishFailureNeverResetsAReviewedTicket` and defer the staging reproduction.
- **Key expired/revoked mid-run**: assert no push/PR; the start/failure is fatal; ticket left for recovery.
- **Lease loss/expired before publish**: assert no push/PR; ticket left for recovery.
- **Duplicate start/lease**: assert 409 and no clone.
- **Crash/restart, scheduled reaper, ticket release, idempotent publish**: Phase B/slice 2; mark deferred with expected behavior.

#### Cleanup

- Close/delete the test PR and branch if safe.
- Delete the test ticket/project/agent and harness rows; use IDs recorded above.
- If cleanup is blocked, run:

```sql
DELETE FROM harness_checkpoints WHERE run_id IN
  (SELECT id FROM harness_runs WHERE ticket_id = :ticket_id);
DELETE FROM harness_leases WHERE ticket_id = :ticket_id;
DELETE FROM harness_runs WHERE ticket_id = :ticket_id;
DELETE FROM tickets WHERE id = :ticket_id;
DELETE FROM agents WHERE id = :agent_id;
DELETE FROM projects WHERE id = :project_id;
```

(Use the actual test IDs; never run against production.)

---

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.

---

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run |


- **Status**: planned
- **Date completed**: —
- **PR**: —
- **Branch**: —
- **Residual rows**: none (verify)
- **Manual staging evidence**: —
- **Deferred cases**: Phase B/slice 2

---

*This specification is the contract between planning and execution.*
