# 02 — Design (bt-60)

> **Owns:** current-state audit, design, data flow, contracts, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file operations (`04`), status and deferrals (`00`).

## Current State

### Existing Backend
- Routes: `backend/src/api/harnessRuns.js`; mounted at `/api/v1/harness` in `backend/src/api/v1/index.js`.
- Service: `backend/src/services/HarnessRunService.js`.
- Migrations: `045_harness_runs.sql`, `046_harness_run_reconciliation.sql`,
  `047_harness_checkpoint_publish_evidence.sql` (each with rollback).
- Endpoints: start/checkpoint/heartbeat/finish, leases, `/publish`, `/reconcile`,
  `/dead-letter`, `/adopt` and `/release-ticket`; startup recovery also uses
  `GET /agents/:runtimeId/runs` and `/workspaces`.
- Route tests: `backend/src/__tests__/api-harness-runs.test.js` (service mocked).
- Service/Postgres integration: `backend/src/__tests__/integration/harnessRuns.test.js` (45 tests).
- Reaper: `backend/src/services/HarnessReaper.js`, `harnessReaper.test.js`,
  `harnessReaperSchedule.test.js`.
- Bash integration runner: `backend/integration-test/run.sh`; no harness suite.
- No test drives the real app + real service + real Postgres through the harness routes.

### Existing Agent/Client
- `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java` — real HTTP client against a local `HttpServer`; paths/body/auth/error classification.
- `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` — supervisor lifecycle with `ApiService` mocked, including startup recovery (fresh-heartbeat/lease skip, stale fail/release, publish adoption), lease loss and unconfirmed finish.
- `HarnessTicketProcessor` uses the real `ApiService` in production.
- No JUnit test starts the real backend; no staging run exercises OpenCode/GitHub/PR.

### Gap Analysis

| Layer | Covered by | Gap |
|---|---|---|
| Java HTTP client | `ApiServiceHarnessTest` | Stub server, not real routes |
| Express routes | `api-harness-runs.test.js` | Service mocked |
| Service + Postgres | `harnessRuns.test.js` | No HTTP/client |
| Supervisor | `HarnessTicketProcessorTest` | `ApiService` mocked |
| Real OpenCode/GitHub/PR | none | No disposable staging smoke |
| Finish failure after publish | processor unit test | No real HTTP/DB reproduction |
| Crash/reaper/idempotent publish | `harnessReaper.test.js`, `harnessReaperSchedule.test.js`, processor recovery tests | No HTTP/client/DB composition or staging run for these paths |

---

## Design

### Recommended Architecture: Layered End-to-End Validation

#### Layer 1 — Backend HTTP/Postgres e2e (automated, CI)

New files:

- `backend/src/__tests__/integration/harnessE2EFixtures.js`
- `backend/src/__tests__/integration/harnessHttpE2E.test.js`

The test uses `supertest(app)` against the real Express app and the real Postgres pool configured by `jest.integration.config.js`. It does **not** mock `HarnessRunService`.

Fixture responsibilities:

- Create a unique test user (owner), project, enrolled node, worker runtime,
  node grant and ticket assigned to the runtime; use `Date.now() + random`
  suffix.
- Mint a node access token through `AgentNodeService` (or insert the matching
  `token_prefix`/`token_hash`) and return the plaintext token plus the runtime
  id for `X-Agent-Runtime`.
- Create a second owner/project/node/runtime/ticket for cross-tenant and
  authorization tests, and a revoked-node token for E5.
- Expose `createHarnessFixture()`, `createOtherHarnessFixture()`, `cleanupHarnessFixtures()`.
- Clean up in `afterAll`; rely on FK cascade for runs/checkpoints/leases;
  explicitly delete test users/projects/nodes/runtimes/tickets if needed.
- Never use an existing product ticket or production repository.

Test groups:

1. **Start**
   - A node access token plus `X-Agent-Runtime` starts a run for its assigned
     `in_progress` ticket → 201; DB row `running`, `created`, attempt 1.
   - Missing/invalid/revoked token → 401 (client-side behavior covered by
     `ApiServiceHarnessTest`; route behavior here).
   - JWT caller → 403.
   - Wrong owner/runtime → 403; ticket not `in_progress` → 403.
   - Duplicate start while a run is active → 409 `CONFLICT`.
2. **Lease**
   - Claim → 201; row for ticket.
   - Second run/ticket mismatch → 409.
   - Renew → 200; renew with a missing/mismatched run → 409 (route returns
     `CONFLICT`); release → 200; release missing → 404.
   - Ticket released/reassigned → renewal 409 (service integration already
     covers; HTTP smoke here).
3. **Checkpoints**
   - Record `cloned` with `workspacePath`/`baseSha`, `session_ready` with `sessionId`, `prompting`, `verifying`, `publishing`, `done` → 201 each; DB step advances; context columns filled.
   - Backwards step → 409; unknown step → 400; after finish → 404.
4. **Heartbeat**
   - Heartbeat updates `heartbeat_at` and `agent_step`; wrong agent → 404; after finish → 404.
5. **Finish**
   - Finish succeeded → 200; DB status/head_sha/pr_url; lease deleted.
   - Idempotent second finish → 200 with existing terminal state.
   - Wrong runtime → 403; JWT mutation → 403.
6. **Operator reads**
   - Project owner/member JWT → 200 for run and checkpoints.
   - `user` role → 403; non-member → 403; super_admin → 200.
   - Runtime can read its own run; another runtime → 403.
7. **Operator actions** — `/publish`, `/reconcile`, `/dead-letter`, `/adopt`
   and `/release-ticket` over HTTP where the route allows it; assert guards,
   authorization and idempotency.
8. **Cleanup** — all fixtures removed; no residual runs/leases/checkpoints.

#### Layer 2 — Agent contract/processor (existing, gap-check only)

`ApiServiceHarnessTest` already covers the real HTTP client paths/bodies/auth/error mapping. `HarnessTicketProcessorTest` covers the supervisor lifecycle and failure cases. During implementation, check for these gaps and extend only if missing:

- start 401/`KEY_EXPIRED` fatal behavior (start classification is covered in
  `ApiServiceHarnessTest`/processor tests; **mid-run expiry is not directly
  tested** — add a focused processor test or keep E17 manual-only and track it
  in `00` D7);
- finish failure after a successful publish (covered in `successFinishFailureNeverResetsAReviewedTicket`);
- lease loss before publish (covered);
- start 409/403 (covered in `fatalStartErrorSkipsCloningAndLeavesTheTicketForRecovery`).

No new Java test is required unless the e2e planning finds a concrete gap.

#### Layer 3 — Disposable staging run (manual, Phase A)

Use a dedicated test project/repository and throwaway ticket. This is the only layer that exercises real OpenCode, provider, Git and GitHub.

Configuration:

```text
HARNESS_DURABILITY_REQUIRED=true
HARNESS_LEASE_SECONDS=60
HARNESS_HEARTBEAT_SECONDS=10     # clamped to <= lease/2
HARNESS_MAX_DURATION_MINUTES=5
HARNESS_VERIFY_COMMANDS=<safe, fast command for the test repo>
```

Setup:

1. Create a dedicated test project and test GitHub repository.
2. Register a project-scoped provider credential and verified worker model.
3. Enroll a test node and declare a worker runtime (supervisor config) with
   the project grant.
4. Create a throwaway ticket with a trivial change and a small scope.
5. Run the real supervisor process.
6. Assert the DB/PR/ticket state (see test matrix).
7. Clean up the test ticket/PR/branch and any stuck run/lease.

Never use a normal product ticket. fg-33 slices 1-3 and the reaper are merged
(#110); if a crash outlives the reaper interval, use the runbook to reconcile
or clean up.

#### Layer 4 — Optional CI Docker e2e (Phase B/follow-up)

A fully containerized real-agent e2e (compose + test repo + fake/real GitHub/provider) is intentionally deferred. It needs secrets, a test repo, a provider key, and a longer CI budget. It becomes worthwhile once Phase B has exercised the reaper/reconcile paths
and CI has the budget and secrets.

---

## Data Flow

```
Test/manual ticket
   │
   ▼
Supervisor / HarnessTicketProcessor
   │  ApiService (real HTTP, X-API-Key node token + X-Agent-Runtime)
   ▼
Express /api/v1/harness routes
   │  verifyTokenOrAgent, requireRuntime, ownership/project checks
   ▼
HarnessRunService
   │  parameterized SQL / CTEs
   ▼
Postgres: harness_runs / checkpoints / leases (runtime_id)
   │
   ├── OpenCode/provider (manual staging)
   └── Git/GitHub PR (manual staging)
```

For the backend HTTP e2e, the test asserts the same DB state at each arrow. For the manual staging run, the test asserts the final DB/PR/ticket state plus the failure cases.

---

## Dependencies

### Backend
- Real Postgres available through `DATABASE_URL`; `jest.integration.config.js` setup applies migrations.
- `supertest`, `bcryptjs`, `jsonwebtoken` already used by tests.
- Harness routes, service, reaper and migrations 045-047 from fg-33 slices 1-3
  (#110).
- `AgentNodeService` looks up `at_…` node tokens by `token_prefix` and verifies
  the hash with `AgentTokenService.matches`; `X-Agent-Runtime` must resolve to a
  runtime owned by that node. Fixtures must mint a real token (prefer the
  enrollment/`AgentNodeService` path) instead of hand-writing a hash.

### Agent
- Existing `ApiServiceHarnessTest`, `HarnessTicketProcessorTest`.
- A real supervisor process with a node credential and a `SUPERVISOR_CONFIG`
  worker runtime for the manual staging run.
- OpenCode binary, verified provider model and test repo/installation for
  manual staging.

### Cross-Cutting
- fg-33 slices 1-3 are merged, so E19-E21 can run against the real
  recovery/reconcile/reaper paths.
- No new npm/Maven dependencies planned.

---

## Config / Environment Changes

- No new env vars.
- Automated backend test uses `DATABASE_URL` from the integration config.
- Manual staging uses the fg-54 node settings (`BACKEND_URL`,
  `AGENT_CREDENTIALS_FILE`, `ENROLLMENT_TOKEN`, `SUPERVISOR_CONFIG`,
  `SANDBOX_MODE`) plus the existing `HARNESS_*` variables;
  `HARNESS_DURABILITY_REQUIRED=true` is required.
- Do not commit test credentials.

---

## Database Changes

No production migration. Test fixtures use:

- `users`, `projects`, `agent_nodes`, `agent_node_grants`, `agent_runtimes`,
  `provider_credentials`, `provider_models`, `tickets` (unique suffix)
- `harness_runs`, `harness_checkpoints`, `harness_leases` (created/deleted through the API or cleanup cascade)

Fixture cleanup must remove test users/projects/nodes/runtimes/credentials/tickets
and rely on `ON DELETE CASCADE` for harness rows. If a test fails mid-run,
cleanup still runs in `afterAll`; a documented manual cleanup SQL is included
in `05_RUNBOOK.md`.

---

## Failure Handling and Cleanup

- Automated test failure: `afterAll` deletes test owners/projects/nodes/runtimes/tickets; if a connection is broken, document manual SQL.
- Manual staging failure: record ticket/run/lease IDs; run the cleanup SQL; close any test PR/branch; never leave a stuck test ticket.
- Finish failure: the expected state is ticket `review` + run recoverable; do not release/reset a reviewed ticket.
- Lease loss/crash: startup recovery and the reaper now handle it; record the
  observed state, and use the runbook only if the sweep has not run yet.

---

## Security Considerations

- Use a dedicated test project/repo/node/runtime; no production data.
- Run the staging supervisor on a disposable/isolated host. It executes real
  repo code with a real provider key and GitHub installation; D14 is merged,
  D16 remains open.
- Use a GitHub App installation scoped to the one test repo and revoke it after
  the run.
- Use a dedicated, spend-capped provider key.
- Verify `DATABASE_URL` points at a disposable test database **before** any
  cleanup SQL runs.
- Never commit provider/GitHub keys or node credentials.
- JWT tests generate short-lived test tokens with the test secret; no real users.
- Node fixtures mint a scoped access token; clean up the node and runtime.
- The manual runbook must state that the test repo/PR is disposable.

---

## Risks and Edge Cases

1. **Reaper timing** — the reaper is interval-based; tests must invoke the
   sweep directly or poll/wait, and staging must allow the interval to elapse.
2. **Real provider/OpenCode instability** — manual staging may be flaky; keep a small ticket/trivial change and record failure details.
3. **GitHub credentials/test repo** — must be a dedicated test repo; never production.
4. **Test DB cleanup** — unique suffix + `afterAll`; verify no residual rows after a failed run.
5. **Finish-failure reproduction** — no production fault switch; use a proxy/controlled outage or rely on the processor unit test in Phase A; add a test seam only with approval.
6. **CI cost** — full containerized e2e deferred; backend HTTP e2e is lightweight.
7. **Node token hash** — the auth lookup uses `token_prefix` then verifies the
   stored hash; a fixture that writes an arbitrary token returns 401. Mint the
   token through the node service/enrollment path.
8. **JWT scope** — project membership/role setup must match the route's `OPERATOR_ROLES` and project-scope query.

---

## Alternatives Considered

### Alternative 1: Full Docker Compose e2e as Phase A
- Pros: most realistic.
- Cons: needs provider/GitHub secrets, test repo, longer CI, flakier; hidden
  failure modes; premature before the Phase B paths are exercised.
- Decision: defer to Phase B/follow-up; use manual staging now.

### Alternative 2: Manual ticket only
- Pros: fastest.
- Cons: not repeatable; no CI regression protection; easy to leave stuck tickets.
- Decision: pair manual staging with automated backend HTTP e2e.

### Alternative 3: Extend existing route tests with real service
- Pros: less new infrastructure.
- Cons: route tests are mock-based; a separate composition test keeps the real DB/HTTP path explicit.
- Decision: new `harnessHttpE2E.test.js`.

---

## Rollout

1. Land the backend HTTP e2e + fixtures (Phase A).
2. Run the disposable staging happy path; record results.
3. Run slice-1 failure cases (start 4xx, lease conflict, finish failure at processor layer, key expiry).
4. Add crash/reaper/idempotent-publish cases (Phase B); the routes and reaper
   already exist in fg-33 (#110).
5. Extend the HTTP e2e with `/publish`, `/reconcile`, `/dead-letter`, `/adopt`
   and `/release-ticket` coverage.
6. Optionally add a containerized CI e2e follow-up.
7. No production deployment impact.

---

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
