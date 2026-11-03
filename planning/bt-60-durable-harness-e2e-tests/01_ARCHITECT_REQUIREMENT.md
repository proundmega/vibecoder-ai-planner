# 01 — Requirement (bt-60)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

fg-33 slice 1 added durable harness runs, checkpoints and leases. The current
coverage is split across layers:

- `ApiServiceHarnessTest` tests the Java HTTP client against a local stub
  server.
- `api-harness-runs.test.js` tests the Express routes with
  `HarnessRunService` mocked.
- `harnessRuns.test.js` tests `HarnessRunService` against real Postgres.
- `HarnessTicketProcessorTest` tests the Java supervisor with `ApiService`
  mocked.

No test exercises the complete composition **real Java agent/HTTP client →
real `/api/v1/harness` routes → real Postgres**, and no disposable staging run
has validated the real OpenCode/GitHub/PR path. A path, body, auth,
project-scope or finish-failure bug can therefore pass every mocked/split test.

This is a **test/validation ticket**: no production behavior change is
expected.

## Goals

1. Prove the composition from a real agent HTTP client through the real routes
   to real Postgres.
2. Provide a repeatable, disposable staging runbook for the real
   OpenCode/provider/GitHub/PR path.
3. Detect contract, authorization and finish-failure gaps that split-layer
   tests miss.
4. Run the automated Phase A immediately; the manual staging layer waits on
   the credentials below. Phase B is unblocked now that fg-33 slices 1-3 are
   merged (#110).

## Non-goals

- Any production code change (unless a test-only seam is unavoidable and
  approved; prefer none).
- Re-implementing or re-testing split-layer behavior that already has coverage.
- A permanent staging environment.
- Frontend run-state UI.
- fg-34 sandbox, fg-41 observability and fg-42 privacy implementation.
- Using a production ticket, repository, PR or data.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Disposable fixtures create an owner, project, agent, ticket and a second cross-tenant fixture with a unique suffix, then clean up every row. | After the suite, no test users/projects/agents/tickets/runs/leases/checkpoints remain; a failed run still cleans up in `afterAll`. |
| FR2 | A backend HTTP/Postgres e2e uses the real Express app and real Postgres, with no mocked routes or service. | `harnessHttpE2E.test.js` drives start → claim → checkpoints → heartbeat → finish through `/api/v1/harness` with an agent API key. |
| FR3 | The e2e asserts persisted state, not only HTTP status. | `harness_runs` status/step/attempt/head_sha/pr_url, `harness_checkpoints` order/context, and `harness_leases` claim/renew/release are asserted. |
| FR4 | Auth, ownership and project scope are exercised through the routes. | Wrong agent/owner/status → 403; JWT mutation → 403; project owner/member read → 200; outside-project → 403; super_admin → 200. |
| FR5 | Lifecycle guards hold over HTTP. | Duplicate start → 409 with one active run; backwards/unknown/after-finish checkpoints rejected; finish is idempotent and releases the lease. |
| FR6 | A manual staging happy path runs against a disposable project, repo, ticket and agent. | Run/checkpoint/lease/ticket/PR state matches expectations and every artifact is cleaned up. |
| FR7 | Phase A failure cases are exercised where slice 1 supports them. | Finish failure after publish leaves the ticket in `review` with no release/reset; start 401/expiry classification is covered at the client/processor layer; mid-run expiry is manual-only or covered by a focused processor test (D7); lease loss blocks publish. |
| FR8 | Phase B cases are explicitly marked, not silently claimed. | Crash/restart, reaper/ticket release and idempotent publish are listed as Phase B with their tests; a skipped case is recorded in `00` D7. |
| FR9 | No production data is touched. | The runbook requires a dedicated test project/repo/ticket/agent; no production ticket, repo, PR or credentials appear in the suite or docs. |
| FR10 | The ticket is indexed. | `PENDING.txt` and `planning/HARNESS_ROADMAP.md` point to this suite and show the satisfied fg-33 dependency. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Test-only change. | No production source, migration or behavior change; no test-only production kill switch. |
| NFR2 | Verification stays green. | Backend unit, backend integration, agent `mvn test` and lint pass. |
| NFR3 | Staging safety. | Isolated/disposable host, GitHub token scoped to the one test repo and revoked after, dedicated spend-capped provider key, and a verified disposable `DATABASE_URL` before cleanup SQL. |

## In scope

- Create `backend/src/__tests__/integration/harnessE2EFixtures.js` and
  `backend/src/__tests__/integration/harnessHttpE2E.test.js`.
- Extend `ApiServiceHarnessTest` / `HarnessTicketProcessorTest` only if a
  concrete gap is found; do not duplicate existing coverage.
- Add the verification/failure matrix to
  `03_ARCHITECT_IMPLEMENTATION.md` and the manual runbook to
  `05_RUNBOOK.md`.
- Update `PENDING.txt` and `planning/HARNESS_ROADMAP.md`.

## Out of scope

Summarise only. The authoritative list with reasons, follow-ups and state is
**`00` → Deferred register**.

- Production changes and re-implementing fg-33 recovery/reaper — see `00` D1–D5 (done).
- Containerized CI e2e and automated fault injection — see `00` D7–D8.
- fg-34 sandbox, fg-41 observability, fg-42 privacy — see `00` D9–D11.

## Known unknowns

1. **Test repository and credentials** — which dedicated test repo, provider
   key and GitHub token the staging run will use. Resolve before the manual
   layer; never use production.
2. **Fault injection for `/finish`** — there is no test-only finish-failure
   switch. Use a proxy or controlled outage, or rely on the processor test;
   do not add a production switch.
3. **CI Docker e2e cost** — a real-agent containerized e2e needs secrets and a
   longer budget; it remains a follow-up.
4. **Test DB isolation** — the integration setup applies migrations to the
   configured database; fixtures must use unique suffixes and cleanup.
5. **Agent startup prerequisites** — the real agent needs
   `HARNESS_MODE=opencode`, an OpenCode binary, provider config, a test project
   ID and a test repo. Document exact values without committing secrets.

## Important design decisions

1. **Layered validation** — automated backend HTTP/Postgres e2e + existing
   agent client/processor tests + a disposable manual staging run. A fully
   containerized CI e2e is a follow-up.
2. **Disposable test ticket** — dedicated test project/repo and throwaway
   ticket, never a product ticket.
3. **Phase split** — Phase A covers the happy path and slice-1 failure cases;
   Phase B covers crash/reaper/idempotent-publish. Both dependencies are now
   satisfied.
4. **No production changes** — prefer a test harness/proxy over a test-only
   production switch.

## Dependencies

- Depends on: fg-33 slices 1-3 (merged, #110).
- Requires for the manual layer: disposable test project/repo/agent, provider
  key, GitHub token.
- Blocks: no other ticket; provides validation evidence for fg-33.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
