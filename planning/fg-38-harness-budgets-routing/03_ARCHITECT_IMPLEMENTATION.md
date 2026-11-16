# 03 — Implementation (fg-38)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Define what is metered and where the numbers come from
- [x] Add a live budget tracker fed by OpenCode events
- [x] Enforce hard stops at safe checkpoints and kill the session on breach
- [x] Add per-ticket, per-project and per-agent quotas
- [x] Define model routing policy and fallback/circuit breaker
- [x] Link usage to tickets, runs and billing
- [x] Add cost/token dashboards and alerts
- [x] Test breach, fallback, price calculation and concurrency

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/052_harness_budgets.sql` (+ rollback) | add | `harness_usage`, versioned `model_prices`, `harness_budget_policies`, `harness_kill_switches`, immutable kill-switch audit, run reservation/artifact markers and idempotent billing index |
| `backend/src/__tests__/integration/harnessQuotaRace.test.js` | add | Real-Postgres concurrent start race: only one run reserves the last daily budget |
| `backend/src/migrations/apply.js` | change | Register 051/052 in array order |
| `backend/src/services/HarnessBudgetService.js` | add | Policy resolution, versioned pricing, daily spend, kill switch, transaction advisory lock and quota gate |
| `backend/src/services/HarnessUsageService.js` | add | Cumulative run/model usage, backend-priced cost, project summary and idempotent `usage_logs` flush |
| `backend/src/services/HarnessRunService.js` | change | Project link on start, kill switch on start/claim/renew, quota checks inside the start transaction |
| `backend/src/api/harnessRuns.js` | change | Return policy with run start; flush usage and audit on finish |
| `backend/src/api/harnessObservability.js` | add | Usage ingestion/read, budget policy and kill-switch routes |
| `backend/src/services/HarnessDashboardService.js` | add | Cost/budget dashboards and budget alerts |
| `agent/.../BudgetLimits.java` | add | Per-run hard limits and defaults |
| `agent/.../ModelPrice.java` | add | Versioned per-million pricing record |
| `agent/.../HarnessBudgetPolicy.java` | add | Safe parsing of backend policy and local defaults |
| `agent/.../HarnessBudgetTracker.java` | add | Live token/cost/tool/time meter, 80% warning and 100% breach |
| `agent/.../OpenCodeUsage.java` | add | Token/tool extraction from OpenCode events |
| `agent/.../ModelRouter.java` | add | free/paid routing, complexity scoring and budget-aware fallback |
| `agent/.../ProviderHealth.java` | add | Per-model circuit breaker for transient provider failures |
| `agent/.../HarnessConfig.java` | change | Routed model and effective budget duration |
| `agent/.../HarnessTicketProcessor.java` | change | Routing, metering, daily-budget cap, watchdog, hard stops, `budget_exceeded` finish and usage reporting |
| `backend/src/__tests__/integration/harnessBudgetMigration.test.js` | add | Real-Postgres 052 apply/rollback, usage expression index and policy/kill-switch constraints |
| `backend/src/__tests__/integration/harnessBudgetPolicy.test.js` | add | Real-Postgres partial policy update preserves omitted fields |
| `agent/src/main/java/.../service/ApiService.java` | change | Start-response policy capture, event emission and usage reporting |
| `frontend/src/views/HarnessObservability.vue` | add | Budget policy editor, spend, kill switch and cost by model |

## Dependencies

- fg-30 Phase 1 (done)
- fg-33 (done, used for usage attribution)
- fg-41 slice 1 (events, same branch)

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Agent | `HarnessBudgetTrackerTest.java`, `OpenCodeUsageTest.java` | token/tool extraction, wall-clock metering, dedupe of part updates | `cd agent && mvn test` |
| FR2 | Agent + Backend | `HarnessBudgetTrackerTest.java`, `harnessBudgetService.test.js`, `harnessUsageService.test.js` | versioned price calculation incl. cached tokens | `mvn test`, `npm test` |
| FR3 | Agent | `HarnessTicketProcessorTest.java` | breach closes session, finishes `budget_exceeded`, releases and never publishes | `mvn test` |
| FR4 | Agent | `HarnessBudgetTrackerTest.java` | one warning per dimension at the soft ratio, run continues | `mvn test` |
| FR5 | Backend + Agent | `harnessBudgetService.test.js`, `harnessRunService.test.js`, `harnessBudgetPolicy.test.js`, `harnessQuotaRace.test.js`, `HarnessTicketProcessorTest.java` | retry cap, daily/project/agent quotas, reservations under concurrent starts, partial policy updates and mid-run daily-budget breach | `npm test`, `npm run test:integration`, `mvn test` |
| FR6 | Agent | `ModelRouterTest.java` | free_only, paid_for_complex, free_then_paid, paid_only | `mvn test` |
| FR7 | Agent | `ProviderHealthTest.java`, `ModelRouterTest.java` | transient failures open a circuit; alternate model or clean failure | `mvn test` |
| FR8 | Both | `harnessUsageService.test.js`, `HarnessTicketProcessorTest.java` | usage attributed to run/ticket/project/agent/model and flushed to billing once | `npm test`, `mvn test` |
| FR9 | Backend | `harnessBudgetService.test.js`, `harnessRunService.test.js` | attempt above `maxRetries` is refused; retries share the same daily/run budget | `npm test` |
| FR10 | Backend | `harnessBudgetService.test.js`, `harnessRunService.test.js` | kill switch blocks starts and withdraws leases from active runs | `npm test` |

## Review checklist

- [x] Every `FR*`/`NFR*` has a passing row in the matrix
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration has a rollback and is registered in `apply.js`
- [x] API contract matches `02`; OpenAPI/types regenerated if it changed
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-16 | stacked PRs #163/#164/#165 | fg-38 | Implemented; backend 140/140 suites (1753 tests), agent 695 tests and frontend 571 tests green; pending review/merge |
