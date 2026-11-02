# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Agent (test-only)
**Date**: 2026-11-02
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, fg-33, PR #110

---

## Problem Statement

fg-33 slice 1 has good split-layer coverage, but no test proves that the layers compose. The Java `ApiService` is tested against a stub server; the Express routes are tested with the service mocked; the service is tested against Postgres; the supervisor is tested with `ApiService` mocked. The real path — **agent HTTP client → real routes → real service → real Postgres → real OpenCode/Git/PR** — is untested. A wrong path/body/auth assumption, project-scope mistake, or finish-failure bug can pass all current tests.

This ticket adds an automated backend HTTP/Postgres e2e and a disposable staging runbook for the full real-agent path. It does not add production features.

---

## Current State

### Existing Backend
- Routes: `backend/src/api/harnessRuns.js`; mounted at `/api/v1/harness` in `backend/src/api/v1/index.js`.
- Service: `backend/src/services/HarnessRunService.js`.
- Migration: `backend/src/migrations/045_harness_runs.sql` with rollback.
- Route tests: `backend/src/__tests__/api-harness-runs.test.js` (service mocked).
- Service/Postgres integration: `backend/src/__tests__/integration/harnessRuns.test.js` (11 tests).
- Bash integration runner: `backend/integration-test/run.sh`; no harness suite.
- No test drives the real app + real service + real Postgres through the harness routes.

### Existing Agent/Client
- `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java` — real HTTP client against a local `HttpServer`; paths/body/auth/error classification.
- `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` — supervisor lifecycle with `ApiService` mocked.
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
| Crash/reaper/idempotent publish | none | Blocked on fg-33 slice 2 |

---

## Design

### Recommended Architecture: Layered End-to-End Validation

#### Layer 1 — Backend HTTP/Postgres e2e (automated, CI)

New files:

- `backend/src/__tests__/integration/harnessE2EFixtures.js`
- `backend/src/__tests__/integration/harnessHttpE2E.test.js`

The test uses `supertest(app)` against the real Express app and the real giant Postgres pool configured by `jest.integration.config.js`. It does **not** mock `HarnessRunService`.

Fixture responsibilities:

- Create a unique test user (owner), project, agent (with a bcrypt-hashed API key), and ticket assigned to the owner; use `Date.now() + random` suffix.
- Create a second owner/project/agent/ticket for cross-tenant/authorization tests.
- Expose `createHarnessFixture()`, `createOtherHarnessFixture()`, `cleanupHarnessFixtures()`.
- Clean up in `afterAll`; rely on FK cascade for runs/checkpoints/leases; explicitly delete test users/projects/agents/tickets if needed.
- Never use an existing product ticket or production repository.

Test groups:

1. **Start**
   - Agent API key starts a run for its assigned `in_progress` ticket → 201; DB row `running`, `created`, attempt 1.
   - Missing/invalid/expired key → 401 (client-side behavior covered by `ApiServiceHarnessTest`; route behavior here).
   - JWT caller → 403.
   - Wrong owner/agent → 403; ticket not `in_progress` → 403.
   - Duplicate start while a run is active → 409 `CONFLICT`.
2. **Lease**
   - Claim → 201; row for ticket.
   - Second run/ticket mismatch → 409.
   - Renew → 200; release → 200; missing → 404.
   - Ticket released/reassigned → renewal null/409 (service integration already covers; HTTP smoke here).
3. **Checkpoints**
   - Record `cloned` with `workspacePath`/`baseSha`, `session_ready` with `sessionId`, `prompting`, `verifying`, `publishing`, `done` → 201 each; DB step advances; context columns filled.
   - Backwards step → 409; unknown step → 400; after finish → 404.
4. **Heartbeat**
   - Heartbeat updates `heartbeat_at` and `agent_step`; wrong agent → 404; after finish → 404.
5. **Finish**
   - Finish succeeded → 200; DB status/head/pr; lease deleted.
   - Idempotent second finish → 200 with existing terminal state.
   - Wrong agent → 403; JWT mutation → 403.
6. **Operator reads**
   - Project owner/member JWT → 200 for run and checkpoints.
   - `user` role → 403; non-member → 403; super_admin → 200.
   - Agent can read its own run; another agent → 403.
7. **Cleanup** — all fixtures removed; no residual runs/leases/checkpoints.

#### Layer 2 — Agent contract/processor (existing, gap-check only)

`ApiServiceHarnessTest` already covers the real HTTP client paths/bodies/auth/error mapping. `HarnessTicketProcessorTest` covers the supervisor lifecycle and failure cases. During implementation, check for these gaps and extend only if missing:

- start 401/`KEY_EXPIRED` fatal behavior (currently covered in classification and processor tests);
- finish failure after a successful publish (covered in `successFinishFailureNeverResetsAReviewedTicket`);
- lease loss before publish (covered);
- start 409/403 (covered in `fatalStartErrorSkipsCloningAndLeavesTheTicketForRecovery`).

No new Java test is required unless the e2e planning finds a concrete gap.

#### Layer 3 — Disposable staging run (manual, Phase A)

Use a dedicated test project/repository and throwaway ticket. This is the only layer that exercises real OpenCode, provider, Git and GitHub.

Configuration:

```text
HARNESS_MODE=opencode
HARNESS_DURABILITY_REQUIRED=true
HARNESS_LEASE_SECONDS=60
HARNESS_HEARTBEAT_SECONDS=10     # clamped to <= lease/2
HARNESS_MAX_DURATION_MINUTES=5
HARNESS_VERIFY_COMMANDS=<safe, fast command for the test repo>
```

Setup:

1. Create a dedicated test project and test GitHub repository.
2. Create a test agent (not a production agent) with the project/provider/GitHub configuration.
3. Create a throwaway ticket with a trivial change and a small scope.
4. Run the real agent process.
5. Assert the DB/PR/ticket state (see test matrix).
6. Clean up the test ticket/PR/branch and any stuck run/lease.

Never use a normal product ticket. Slice 2 recovery/reaper is not available yet; a crash or lease loss can leave the ticket stuck until manual cleanup.

#### Layer 4 — Optional CI Docker e2e (Phase B/follow-up)

A fully containerized real-agent e2e (compose + test repo + fake/real GitHub/provider) is intentionally deferred. It needs secrets, a test repo, a provider key, and a longer CI budget. It becomes worthwhile after slice 2 lands and the reaper/ticket release is wired.

---

## Test Matrix

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

## Data Flow

```
Test/manual ticket
   │
   ▼
Agent HarnessTicketProcessor
   │  ApiService (real HTTP, X-API-Key)
   ▼
Express /api/v1/harness routes
   │  verifyTokenOrAgent, ownership/project checks
   ▼
HarnessRunService
   │  parameterized SQL / CTEs
   ▼
Postgres: harness_runs / checkpoints / leases
   │
   ├── OpenCode/provider (manual staging)
   └── Git/GitHub PR (manual staging)
```

For the backend HTTP e2e, the test asserts the same DB state at each arrow. For the manual staging run, the test asserts the final DB/PR/ticket state plus the failure cases.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|---|---|---|
| `backend/src/__tests__/integration/harnessE2EFixtures.js` | CREATE | Fixture creation/cleanup helpers |
| `backend/src/__tests__/integration/harnessHttpE2E.test.js` | CREATE | Real app + real Postgres HTTP/DB e2e |
| `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java` | EXTEND only if gap | Client contract gap found during planning |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` | EXTEND only if gap | Processor gap found during planning |
| `planning/bt-60-durable-harness-e2e-tests/03_ARCHITECT_IMPLEMENTATION.md` | MODIFY | Runbook/results as implementation proceeds |
| `PENDING.txt` | MODIFY | Backlog row |
| `planning/HARNESS_ROADMAP.md` | MODIFY | fg-33 validation index |
| Production source/migrations | NONE | Test-only |

---

## Dependencies

### Backend
- Real Postgres available through `DATABASE_URL`; `jest.integration.config.js` setup applies migrations.
- `supertest`, `bcryptjs`, `jsonwebtoken` already used by tests.
- Harness routes/service/migration from fg-33 slice 1.
- `AgentService.getAgentByApiKey` and agent schema with `api_key_hash` (migration 033) for the test agent.

### Agent
- Existing `ApiServiceHarnessTest`, `HarnessTicketProcessorTest`.
- A real agent process/config for the manual staging run.
- OpenCode binary, provider key, test repo/token for manual staging.

### Cross-Cutting
- Slice 2 for E19-E21 and the full reaper/ticket-release behavior.
- No new npm/Maven dependencies planned.

---

## Config / Environment Changes

- No new env vars.
- Automated backend test uses `DATABASE_URL` from the integration config.
- Manual staging uses existing `HARNESS_*` variables; `HARNESS_DURABILITY_REQUIRED=true` is required.
- Do not commit test credentials.

---

## Database Changes

No production migration. Test fixtures use:

- `users`, `projects`, `agents`, `tickets` (unique suffix)
- `harness_runs`, `harness_checkpoints`, `harness_leases` (created/deleted through the API or cleanup cascade)

Fixture cleanup must remove test users/projects/agents/tickets and rely on `ON DELETE CASCADE` for harness rows. If a test fails mid-run, cleanup still runs in `afterAll`; a documented manual cleanup SQL is included in `03`.

---

## Failure Handling and Cleanup

- Automated test failure: `afterAll` deletes test owners/projects/agents/tickets; if a connection is broken, document manual SQL.
- Manual staging failure: record ticket/run/lease IDs; run the cleanup SQL; close any test PR/branch; never leave a stuck test ticket.
- Finish failure: the expected state is ticket `review` + run recoverable; do not release/reset a reviewed ticket.
- Lease loss/crash: expected current behavior is manual recovery until slice 2; record the outcome as deferred, not a pass.

---

## Security Considerations

- Use a dedicated test project/repo/agent; no production data.
- Never commit provider/GitHub keys or real agent keys.
- JWT tests generate short-lived test tokens with the test secret; no real users.
- Agent API key fixture uses a bcrypt hash; clean up the agent.
- The manual runbook must state that the test repo/PR is disposable.

---

## Risks and Edge Cases

1. **Slice 2 missing** — crash/reaper/idempotent-publish cases cannot pass yet; split Phase A/B and mark them deferred.
2. **Real provider/OpenCode instability** — manual staging may be flaky; keep a small ticket/trivial change and record failure details.
3. **GitHub credentials/test repo** — must be a dedicated test repo; never production.
4. **Test DB cleanup** — unique suffix + `afterAll`; verify no residual rows after a failed run.
5. **Finish-failure reproduction** — no production fault switch; use a proxy/controlled outage or rely on the processor unit test in Phase A; add a test seam only with approval.
6. **CI cost** — full containerized e2e deferred; backend HTTP e2e is lightweight.
7. **Agent key hash** — creating a real agent fixture requires the correct `api_key_hash` columns; inspect migration 033/AgentService before implementing.
8. **JWT scope** — project membership/role setup must match the route's `OPERATOR_ROLES` and project-scope query.

---

## Alternatives Considered

### Alternative 1: Full Docker Compose e2e as Phase A
- Pros: most realistic.
- Cons: needs provider/GitHub secrets, test repo, longer CI, flakier; hidden failure modes; premature before slice 2.
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
4. After fg-33 slice 2, add crash/reaper/idempotent-publish cases (Phase B).
5. Optionally add a containerized CI e2e follow-up.
6. No production deployment impact.

---

## Pending Scope Items to Present to User

The relevant deferred items are listed in `01_ARCHITECT_REQUIREMENT.md` and repeated here for visibility: startup recovery, resume policy, scheduled reaper + guarded ticket release, idempotent publish, workspace retention, crash-injection/metrics, dead-letter/adoption, fg-34 sandbox, fg-41 observability and fg-42 privacy. Phase A can start after fg-33 slice 1; the full failure matrix waits for slice 2.

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | fg-33 | Startup recovery / resume / scheduled reaper / ticket release / idempotent publish | Reliability | fg-33 slice 2 | ☐ |
| 2 | fg-34 | Sandboxed staging agent | Security | fg-34 | ☐ |
| 3 | bt-60 | Containerized CI e2e + automated fault injection | Testing | follow-up after slice 2 | ☐ |

---

*This design document guides implementation.*
