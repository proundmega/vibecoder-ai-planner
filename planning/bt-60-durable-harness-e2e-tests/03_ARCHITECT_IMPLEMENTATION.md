# 03 — Implementation (bt-60)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`), operational procedure (`05_RUNBOOK.md`).

## Purpose

Prove the durable harness works as a composition, not only as isolated layers:

1. A real Express app + real Postgres HTTP/DB e2e covering `/api/v1/harness`.
2. A disposable staging run for the complete Java agent → real routes →
   Postgres → OpenCode → GitHub PR path.
3. A failure matrix for finish failure, key expiry, lease loss and the
   crash/reaper/idempotent-publish cases.

This is a test-only ticket. Do not modify production behavior.

## Plan

**CRITICAL**: Check whether existing tests already cover a case before adding a
new file. Do not duplicate `ApiServiceHarnessTest` or `harnessRuns.test.js`
assertions.

1. **Fixture helper** — `backend/src/__tests__/integration/harnessE2EFixtures.js`
   - Create a disposable owner/project/agent/ticket with a unique suffix.
   - Create the agent through `AgentService.create` so `api_key_hash`,
     `api_key_hash_prefix` and expiry are all set.
   - Create a member user + `project_memberships` row for the operator read
     tests, a second tenant for cross-tenant tests, and an expired-key agent
     for E5.
   - Expose idempotent cleanup; use the real `pool`.
   - *Depends on*: nothing.

2. **Backend HTTP/Postgres e2e** —
   `backend/src/__tests__/integration/harnessHttpE2E.test.js`
   - Use `supertest(app)` against the real app; no service mocks.
   - Exercise start/claim/checkpoints/heartbeat/finish and DB assertions.
   - Cover auth, ticket assignment, duplicate start, lease conflict, step
     ordering, finish idempotency and operator read scope.
   - Phase B: cover `/publish`, `/reconcile`, `/dead-letter`, `/adopt` and
     `/release-ticket` over HTTP where the route allows it.
   - Cleanup in `afterAll`.
   - *Depends on*: Step 1.

3. **Agent gap check** — existing `ApiServiceHarnessTest` /
   `HarnessTicketProcessorTest`
   - Verify start 401/403/409, finish failure, lease loss and
     checkpoint/heartbeat RunGone are covered.
   - Mid-run key expiry is not directly tested: add a focused processor test,
     or keep E17 manual-only and track it in `00` D7.
   - *Depends on*: Steps 1-2.

4. **Manual staging runbook** — `05_RUNBOOK.md`
   - Dedicated test project/repo/ticket/agent, isolated host, scoped
     credentials.
   - Happy path + failure cases + cleanup.
   - *Depends on*: Steps 1-3 for the automated checks; manual prerequisites
     (test repo/credentials).

5. **Backlog/roadmap updates** — `PENDING.txt`,
   `planning/HARNESS_ROADMAP.md`
   - Keep the bt-60 row and the satisfied fg-33 dependency; update status after
     implementation.
   - *Depends on*: nothing.

### Phase 1: Backend test fixtures

Create `harnessE2EFixtures.js` following existing integration-test patterns:

- Use `new Pool({ connectionString: process.env.DATABASE_URL })` or the shared
  pool from the integration setup; do not leak connections.
- Unique suffix: `${Date.now()}_${Math.floor(Math.random() * 1e6)}`.
- Create:
  - owner user (`role='project_admin'`) and other owner;
  - project owned by each;
  - agent for each owner via `AgentService.create(name, apiKey, ownerId, ...)`
    (sets hash, prefix and expiry) or by setting both `api_key_hash` (bcrypt)
    and `api_key_hash_prefix` (SHA-256, first 20 hex chars);
  - an expired-key agent for E5;
  - a member user plus `project_memberships` row for E14;
  - ticket assigned to the owner, `status='in_progress'` for the happy path;
  - optional `backlog`/review tickets for authorization tests.
- Return IDs and the plaintext test API keys (never real keys).
- Cleanup:
  - delete test users/projects/agents/tickets by IDs;
  - rely on `ON DELETE CASCADE` for harness runs/checkpoints/leases;
  - if a failed test leaves rows, run the cleanup SQL in `05_RUNBOOK.md`.
- Never use existing product rows.

### Phase 2: Backend HTTP/Postgres e2e

Create `harnessHttpE2E.test.js` using `supertest` and the real app. Do not mock
`HarnessRunService`.

Required cases (details in the Verification matrix):

- Start: happy 201; DB row; assigned ticket; duplicate 409; wrong
  owner/status 403; JWT 403; missing/invalid auth 401.
- Lease: claim 201; second claim 409; renew 200 / missing-or-mismatched 409;
  release 200 / missing 404; released/reassigned ticket renewal 409.
- Checkpoints: forward sequence; context columns; backward 409; unknown 400;
  after finish 404.
- Heartbeat: 200; `agent_step`/`heartbeat_at`; wrong agent/after finish 404.
- Finish: 200; status/`head_sha`/`pr_url`; lease deleted; idempotent second
  finish; wrong agent 403.
- Reads: project owner/member JWT 200; user/outside 403; super_admin 200; agent
  own run 200, other agent 403.
- Phase B: publish/reconcile/dead-letter/adopt/release-ticket guards and
  idempotency.
- Cleanup: no residual test rows.

Use `jest.integration.config.js` and the existing
`src/__tests__/integration/setup.js`; the file is discovered by
`**/integration/**/*.test.js`.

### Phase 3: Agent gap check

Do not duplicate existing coverage. Confirm:

- `ApiServiceHarnessTest` covers real client paths/bodies/auth and
  401/409/500 classification.
- `HarnessTicketProcessorTest` covers:
  - start 409/403 fatal → no clone;
  - lease claim error after run creation → fail closed;
  - checkpoint/heartbeat RunGone → no publish;
  - lease expiry before publish → no push/PR;
  - finish failure after successful publish → no release/reset; succeeded
    finish error-free;
  - normal failure finish failure → deferred release/backoff;
  - startup recovery: fresh skip, stale fail/release, publish adoption,
    unconfirmed finish.
- Add a test only if a concrete gap remains. If adding, keep it in the same test
  classes and use existing mocks.

### Phase 4: Manual staging run and failure matrix

Follow `05_RUNBOOK.md`. Use a dedicated test project/repository and a throwaway
ticket. Phase A executes the happy path and slice-1 failure cases. Phase B adds
crash/reaper/idempotent-publish cases now that fg-33 slices 1-3 are merged.

### Phase 5: Documentation

- Update `00_ARCHITECT_CHECKLIST.md` frontmatter (`status`, `pr`, `branch`).
- Record results and manual evidence in the Results table in this document.
- Update `PENDING.txt` status.
- Update `planning/HARNESS_ROADMAP.md` status/validation line.
- If a test-only seam or new env var is introduced (avoid), document it and get
  approval.

## Per-file changes

### `backend/src/__tests__/integration/harnessE2EFixtures.js` (CREATE)

- **Exports**:
  - `createHarnessFixture()` → `{ ownerId, projectId, agentId, agentApiKey,
    memberUserId, ticketId, ticketIds, otherOwnerId, otherProjectId,
    otherAgentId, otherAgentApiKey, otherTicketId, expiredAgentApiKey,
    cleanup }`
  - `cleanupHarnessFixture(fixture)` → deletes users/projects/agents/tickets by
    ID; idempotent.
- **Patterns**:
  - Follow `backend/src/__tests__/integration/harnessRuns.test.js` fixture
    style.
  - Prefer `AgentService.create(name, apiKey, ownerId, ...)`; otherwise set
    both `api_key_hash` (bcrypt) and `api_key_hash_prefix` (SHA-256 first 20
    hex chars). A hash-only fixture returns 401.
  - Use `RETURNING id` and parameterized SQL.
- **Do not** delete unrelated rows; filter by IDs/suffix.
- **Cleanup** in `try/finally` or `afterAll`; log IDs on failure for manual
  cleanup.

### `backend/src/__tests__/integration/harnessHttpE2E.test.js` (CREATE)

- **Imports**:
  - `supertest`, `../../index` (app), `jsonwebtoken`/`getSecret` if needed,
    fixtures helper.
  - Real `pool` only for assertions/cleanup; not for service mocks.
- **Tests**:
  - `describe('harness HTTP e2e')` with `beforeAll` fixture and `afterAll`
    cleanup.
  - Use `request(app).post('/api/v1/harness/runs').set('X-API-Key',
    fixture.agentApiKey)`.
  - Assert `/harness/runs`, `/leases`, `/checkpoints`, `/heartbeat`, `/finish`,
    `/publish`, `/reconcile`, `/dead-letter`, `/adopt`, `/release-ticket`.
  - DB assertions via `pool.query('SELECT ... FROM harness_runs WHERE id=$1')`.
  - JWT tokens signed with the test secret; roles `project_admin`, `member`,
    `user`, `super_admin`; project membership setup.
- **Patterns**:
  - Follow `api-harness-runs.test.js` for route names/status expectations.
  - Follow `harnessRuns.test.js` for DB setup/cleanup.
  - Use `expect(res.statusCode)` and `expect(res.body.success)` consistent with
    existing tests.

### `agent/src/test/java/.../ApiServiceHarnessTest.java` / `HarnessTicketProcessorTest.java` (EXTEND only if gap)

- Do not duplicate existing cases.
- If a gap is found, add a test with the existing `HttpServer`/Mockito patterns.
- Keep tests in the same package/classes.

### `03_ARCHITECT_IMPLEMENTATION.md` (MODIFY)

- Record run results, residual rows and manual evidence in the Results table.
- Do not add a status/date/PR/branch block; those belong to `00` frontmatter.

### `00_ARCHITECT_CHECKLIST.md` (MODIFY)

- Update `status`, `pr` and `branch` in the frontmatter when the ticket moves.

### `PENDING.txt` / `planning/HARNESS_ROADMAP.md` (MODIFY)

- Add/update the bt-60 row.
- Dependency: fg-33 slices 1-3 are merged (#110).
- Lifecycle states: `planned` → `in_progress` → `done`.

## Dependencies

- fg-33 slices 1-3: runs/checkpoints/leases, recovery, reaper and operator
  routes (merged, #110).
- Postgres from `docker compose`/integration config.
- Existing split-layer tests.
- Test project/repo/agent and provider/GitHub credentials for the manual stage.
- No production code changes.

## Risks & edge cases

1. **Reaper timing** — the reaper is interval-based; tests must invoke the
   sweep directly or poll/wait, and staging must allow the interval to elapse.
2. **Agent key fixture** — the auth path looks up `api_key_hash_prefix` and
   then bcrypt-compares `api_key_hash`. Use `AgentService.create`; a fixture
   that sets only the hash returns 401.
3. **JWT project scope** — the operator route requires `OPERATOR_ROLES`
   (super_admin/project_admin/member) plus `AGENT_READ` and project
   owner/member; the `user` role must be denied. Set up project membership
   accordingly.
4. **Finish failure reproduction** — no production switch. Use the processor
   unit test for Phase A; use a proxy/controlled outage in the manual stage or
   add a test-only seam only with approval.
5. **Test DB cleanup** — unique suffix; cleanup in `afterAll`; verify
   `DATABASE_URL` is a disposable test database before running cleanup SQL.
6. **Real provider/OpenCode/GitHub** — flaky/credentialed; use a trivial
   ticket/change, an isolated host, a repo-scoped GitHub token (revoked after),
   a dedicated spend-capped provider key, and never production.
7. **CI cost** — backend HTTP e2e is lightweight; full containerized e2e
   deferred.
8. **Concurrent test execution** — integration config `maxWorkers:1`; still use
   unique suffixes.

## Verification matrix

One row per scenario, tagged with the requirement it proves. E1-E22 are the
original scenarios; E23-E27 cover the non-scenario requirements so every
`FR*`/`NFR*` in `01` has a row.

| Req | ID | Scenario | Layer | Expected | Phase |
|---|---|---|---|---|---|
| FR1 | E23 | Fixture creation and cleanup | Backend HTTP | all test rows removed; cleanup runs after failure | A |
| FR2 | E1 | Agent starts a run for its assigned `in_progress` ticket | Backend HTTP | 201; run `running/created`; attempt 1 | A |
| FR5 | E2 | Duplicate start while run active | Backend HTTP | 409 CONFLICT; one active run | A |
| FR4 | E3 | Wrong agent/owner or wrong ticket status | Backend HTTP | 403; no run | A |
| FR4 | E4 | JWT mutation | Backend HTTP | 403 | A |
| FR7 | E5 | Start with invalid/expired agent key | Client/processor + route | 401; fatal; no publish | A |
| FR3 | E6 | Claim lease and block another run | Backend HTTP | 201; second claim 409 | A |
| FR3 | E7 | Renew/release lease | Backend HTTP | renew 200; renew missing/mismatched 409; release 200; release missing 404 | A |
| FR3/FR5 | E8 | Checkpoint sequence and context columns | Backend HTTP | 201 each; `workspace_path`/`session_id`/`base_sha` populated | A |
| FR3/FR5 | E9 | Backward/unknown checkpoint | Backend HTTP | 409/400 | A |
| FR3/FR5 | E10 | Checkpoint after finish | Backend HTTP | 404 | A |
| FR3 | E11 | Heartbeat updates `agent_step`/`heartbeat_at` | Backend HTTP | 200; wrong agent/after finish 404 | A |
| FR5 | E12 | Finish succeeded; lease deleted | Backend HTTP | 200; status/`head_sha`/`pr_url`; no lease | A |
| FR5 | E13 | Idempotent finish | Backend HTTP | 200 existing terminal; no duplicate side effect | A |
| FR4 | E14 | Operator project scope/roles | Backend HTTP | owner/member 200; user/outside 403; super_admin 200 | A |
| FR6 | E15 | Manual real happy path | Manual staging | run/checkpoints/lease/ticket/PR as expected | A |
| FR7 | E16 | Finish endpoint unavailable after PR | Processor/manual | ticket stays `review`; no reset; run recoverable; reaper reconciles | A/B |
| FR7 | E17 | Key expired/revoked mid-run | Processor/manual | fatal; no push/PR; add a focused processor test or keep manual-only (D7) | A/manual |
| FR7 | E18 | Lease lost/expired before publish | Processor/manual | no push/PR; ticket left for recovery | A |
| FR8 | E19 | Crash/restart mid-prompt/verify/publish | Manual | startup recovery skips fresh runs, fails/releases stale runs without evidence, adopts published runs; reaper reconciles terminal runs; no duplicate PR | B |
| FR8 | E20 | Reaper fails stale run and ticket release | Manual/backend | release only `in_progress`, no `pr_url`; not review/done | B |
| FR8 | E21 | Idempotent publish/duplicate PR | Manual | one branch/PR; no duplicate | B |
| FR8/NFR2 | E22 | Full containerized CI e2e | CI Docker | deterministic happy path + failure cases | B/follow-up |
| FR9 | E24 | No production data used | Manual/review | dedicated test project/repo/ticket/agent; scoped credentials revoked; cleanup verified | A |
| FR10 | E25 | Index updated | Docs | `PENDING.txt` and roadmap point to bt-60 and show the satisfied fg-33 dependency | A |
| NFR1 | E26 | Test-only change | Review | no production source, migration or behavior change | A |
| NFR2 | E27 | Suites and lint | CI | backend unit + integration, agent `mvn test`, lint pass | A/B |
| NFR3 | E28 | Staging safety preconditions | Manual/review | isolated host; repo-scoped token revoked; spend-capped provider key; disposable `DATABASE_URL` verified before cleanup | A |

### Existing agent tests

- `ApiServiceHarnessTest` — paths/body/auth/error classification.
- `HarnessTicketProcessorTest` — run persistence, fatal start, lease loss,
  finish retry/failure, checkpoint/heartbeat RunGone and startup recovery.

### Commands

```bash
cd backend
npx jest --config jest.integration.config.js --runInBand src/__tests__/integration/harnessHttpE2E.test.js
npx jest --config jest.integration.config.js --runInBand
npm test
npm run lint

cd ../agent
mvn test
```

Manual staging: see `05_RUNBOOK.md`.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run |

**Residual rows:** none (verify)
**Manual staging evidence:** —
