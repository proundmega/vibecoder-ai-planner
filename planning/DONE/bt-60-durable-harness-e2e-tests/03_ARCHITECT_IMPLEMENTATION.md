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
   - Create a disposable owner/project/enrolled node/worker runtime/ticket with
     a unique suffix.
   - Mint a node access token and return the runtime id for `X-Agent-Runtime`.
   - Create a member user + `project_memberships` row for the operator read
     tests, a second tenant for cross-tenant tests, and a revoked-node token
     for E5.
   - Expose idempotent cleanup; use the real `pool`.
   - *Depends on*: nothing.

2. **Backend HTTP/Postgres e2e** —
   `backend/src/__tests__/integration/harnessHttpE2E.test.js`
   - Use `supertest(app)` against the real app; no service mocks.
   - [x] Phase B backend drills: E19-E21 and E29.
   - [ ] Real OpenCode/GitHub staging path (E15-E18/E22).
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
   - Dedicated test project/repo/ticket/node/runtime, isolated host, scoped
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
  - enrolled node plus worker runtime for each owner, with an active
    `agent_node_grants` row; mint the node access tokens through
    `AgentNodeService`;
  - a revoked-node token for E5;
  - a member user plus `project_memberships` row for E14;
  - ticket assigned to the runtime (`assigned_runtime_id`), `status='in_progress'`
    for the happy path;
  - optional `backlog`/review tickets for authorization tests.
- Return IDs and the plaintext test node tokens plus runtime IDs (never real
  credentials).
- Cleanup:
  - delete test users/projects/nodes/runtimes/tickets by IDs;
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
  finish; wrong runtime 403.
- Reads: project owner/member JWT 200; user/outside 403; super_admin 200;
  runtime own run 200, other runtime 403.
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
  - `createHarnessFixture()` → `{ ownerId, projectId, nodeId, runtimeId,
    nodeToken, memberUserId, ticketId, ticketIds, otherOwnerId, otherProjectId,
    otherNodeId, otherRuntimeId, otherNodeToken, otherTicketId,
    revokedNodeToken, cleanup }`
  - `cleanupHarnessFixture(fixture)` → deletes users/projects/nodes/runtimes/
    tickets by ID; idempotent.
- **Patterns**:
  - Follow `backend/src/__tests__/integration/harnessRuns.test.js` fixture
    style.
  - Mint node tokens through `AgentNodeService` (prefix + hash); an arbitrary
    token returns 401.
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
  - Use `request(app).post('/api/v1/harness/runs')
    .set('X-API-Key', fixture.nodeToken)
    .set('X-Agent-Runtime', String(fixture.runtimeId))`.
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
- Test project/repo/node/runtime and provider/GitHub credentials for the
  manual stage.
- No production code changes.

## Risks & edge cases

1. **Reaper timing** — the reaper is interval-based; tests must invoke the
   sweep directly or poll/wait, and staging must allow the interval to elapse.
2. **Node token fixture** — the auth path looks up `token_prefix` and verifies
   the stored hash. Mint the token through `AgentNodeService`; an arbitrary
   token returns 401.
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

## Verification

### Verification matrix

One row per scenario, tagged with the requirement it proves. E1-E22 are the
original scenarios; E29 adds the Phase B dead-letter/release guard, and
E23-E28 cover the non-scenario requirements so every
`FR*`/`NFR*` in `01` has a row.

| Req | ID | Scenario | Layer | Expected | Phase |
|---|---|---|---|---|---|
| FR1 | E23 | Fixture creation and cleanup | Backend HTTP | all test rows removed; cleanup runs after failure | A |
| FR2 | E1 | Node runtime starts a run for its assigned `in_progress` ticket | Backend HTTP | 201; run `running/created`; attempt 1 | A |
| FR5 | E2 | Duplicate start while run active | Backend HTTP | 409 CONFLICT; one active run | A |
| FR4 | E3 | Wrong runtime/owner or wrong ticket status | Backend HTTP | 403; no run | A |
| FR4 | E4 | JWT mutation | Backend HTTP | 403 | A |
| FR7 | E5 | Start with invalid/revoked node token | Client/processor + route | 401; fatal; no publish | A |
| FR3 | E6 | Claim lease and block another run | Backend HTTP | 201; second claim 409 | A |
| FR3 | E7 | Renew/release lease | Backend HTTP | renew 200; renew missing/mismatched 409; release 200; release missing 404 | A |
| FR3/FR5 | E8 | Checkpoint sequence and context columns | Backend HTTP | 201 each; `workspace_path`/`session_id`/`base_sha` populated | A |
| FR3/FR5 | E9 | Backward/unknown checkpoint | Backend HTTP | 409/400 | A |
| FR3/FR5 | E10 | Checkpoint after finish | Backend HTTP | 404 | A |
| FR3 | E11 | Heartbeat updates `agent_step`/`heartbeat_at` | Backend HTTP | 200; wrong agent/after finish 404 | A |
| FR5 | E12 | Finish succeeded; lease deleted | Backend HTTP | 200; status/`head_sha`/`pr_url`; `artifacts_finalized_at` set; no lease; wrong runtime 403 | A |
| FR5 | E13 | Idempotent finish | Backend HTTP | 200 existing terminal; artifacts remain finalized (`artifacts_finalized_at` non-null); no duplicate side effect | A |
| FR4 | E14 | Operator project scope/roles | Backend HTTP | owner/member 200; user/outside 403; super_admin 200 | A |
| FR6 | E15 | Manual real happy path | Manual staging | run/checkpoints/lease/ticket/PR as expected | A |
| FR7 | E16 | Finish endpoint unavailable after PR | Processor/manual | ticket stays `review`; no reset; run recoverable; reaper reconciles | A/B |
| FR7 | E17 | Node token revoked mid-run | Processor/manual | fatal; no push/PR; add a focused processor test or keep manual-only (D7) | A/manual |
| FR7 | E18 | Lease lost/expired before publish | Processor/manual | no push/PR; ticket left for recovery; covered by `HarnessTicketProcessorTest#leaseExpiryBeforePublishStopsThePush` | A |
| FR8 | E19 | Crash-equivalent mid-publish (publish evidence + expired lease; not a real supervisor restart) | Backend HTTP + reaper | reaper adopts the stored PR, ticket goes to `review`, one run/PR; real restart remains staging | B |
| FR8 | E20 | Reaper fails a stale unpublished run and releases only an in_progress ticket | Backend HTTP + reaper | run `failed`; in_progress ticket returns to backlog; a second reaper sweep reconciles a failed run on a review ticket but leaves it in `review` | B |
| FR8 | E21 | Idempotent publish/reconcile with identical evidence | Backend HTTP | repeated publish keeps one head/PR; reconcile twice does not duplicate; different-PR/agent-side duplicate detection remains staging | B |
| FR8 | E29 | Dead-letter hold and release-ticket authorization | Backend HTTP | operator dead-letters; agent release is refused; operator release returns the ticket to backlog | B |
| FR8/NFR2 | E22 | Full containerized CI e2e | CI Docker | deterministic happy path + failure cases | B/follow-up |
| FR9 | E24 | No production data used | Manual/review | dedicated test project/repo/ticket/node/runtime; scoped credentials revoked; cleanup verified | A |
| FR10 | E25 | Index updated | Docs (review-only) | `PENDING.txt` and roadmap point to bt-60 and show the satisfied fg-33 dependency; not part of the backend e2e suite because the test image ships only `backend/` | A |
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
| 2026-11-22 | `19cfc33` (PR #198, merged; includes #200 `865565e`) | Phase A: `harnessHttpE2E` 16/16; backend integration 20 suites / 158 tests; backend unit 152 suites / 1788 tests; lint 0 errors (30 warnings); `HarnessTicketProcessorTest#leaseExpiryBeforePublishStopsThePush` 1/1 | Phase A green and merged. E12/E13 assert `artifacts_finalized_at`; the usage-flush UUID defect they exposed is fixed in the separate production PR #200. Phase B staging is deferred pending the disposable repo/key/App installation. |
| 2026-11-23 | `c0ff5c0` (PR #207, merged) | `harnessHttpE2E` 20/20 (E19-E21, E29); backend integration 21 suites / 167 tests; backend unit 1857 tests; lint clean | Phase B backend drills merged: crash-equivalent lease-expiry adoption, stale-run release (including the review-ticket negative case via the reaper), idempotent publish/reconcile, dead-letter/release authorization. The real OpenCode/GitHub staging run remains pending the disposable repo, provider key and GitHub App installation. |
| 2026-11-23 | `d8c9132` (#220 pre-merge build) | Disposable local stack (Postgres/Redis/API, node 1/runtime 1, Docker sandbox `:bt60`); runs `1af4a751` PR #20, `74216219` PR #21, `d23b7862` PR #22, `5a80e787` PR #23; agent 989 tests / 0 failures / 10 skipped | Phase B staging executed on `proundmega/planner-test` with OpenCode 1.19.5 and `opencode-go/beam-free` behind a local session-header proxy; the backend ran in explicit PAT mode after the initial app-mode `GITHUB_APP_NOT_CONFIGURED` configuration error. Happy path, lease-loss abort+retry, health gate after the HTTP/1.1 fix, and supervisor restart recovery pass; stale runs never publish and no duplicate PR/branch appears. Finish-unavailable and key-expiry remain (D7). |
| 2026-11-24 | `110aa97` (master) | Run `98d6f814-903d-4a24-8973-32d30706f237`; PR #24; `head_sha=4b80530`; checkpoints `cloned -> session_ready -> prompting -> verifying -> publishing -> done`; verification `node --check script.js`; no lease | Formal master rerun after #220: health gate passed, child isolation and explicit PAT mode active, OpenCode Go session-header proxy and native supervisor remain staging deviations. Finish-unavailable/key-expiry (D7) and D13/D14 remain. |

| Field | Value |
|---|---|
| Residual rows | none (verified `bt60_*` counts are 0 after the suite) |
| Phase B automated drills | E19-E21, E29 pass in `harnessHttpE2E`; no residual rows |
| Manual staging evidence | Recorded in `05_RUNBOOK.md`; 2026-11-23 runs `1af4a751`/`74216219`/`d23b7862`/`5a80e787` (PRs #20-#23) and the 2026-11-24 master rerun `98d6f814` (PR #24); no residual rows |
