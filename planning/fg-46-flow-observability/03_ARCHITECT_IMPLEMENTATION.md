# 03 — Implementation (fg-46)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Confirm the end-to-end cycle (build -> review -> fix -> merge) works first
- [ ] Define `deriveStage(ticket)` from status/phase/planning/approvals, with documented precedence
- [ ] Define metric definitions and mark which are not yet measurable
- [ ] Add `GET /api/v1/metrics/flow` with JWT + project-membership auth
- [ ] Keep `METRICS_TOKEN` for the Prometheus `/metrics` scrape only
- [ ] Use fg-31/32 tables for review/fix metrics
- [ ] Use `approval_requests` for human-approval timing
- [ ] Reuse the fg-33 `run_id` (no new identifier)
- [ ] Use fg-45 `ready_at`/`plan_approved_at` (fg-45 required, not optional)
- [ ] Implement one `deriveStage` in JS; no parallel SQL `CASE`
- [ ] Paginate all live project tickets (`deleted_at IS NULL`) for exact counts; flag truncation past `FLOW_MAX_SCAN_TICKETS`
- [ ] Call `assertProjectMember` for project-scoped flow views
- [ ] Add `null`/“not instrumented” handling for merge, queue wait and provider latency
- [ ] Add Prometheus counters/histograms (later)
- [ ] Add provider latency/error/token metrics (instrumentation required)
- [ ] Add agent pool and storage metrics (fg-44)
- [ ] Add a Flow dashboard in the UI
- [ ] Add Prometheus/Grafana (or keep the JSON view if enough)
- [ ] Add alerts for stuck tickets, provider errors and disk pressure
- [ ] Keep the first version read-only and cheap to operate

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-30, fg-31, fg-32, fg-33, fg-36, fg-41, fg-44, fg-45

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | | | | |
| FR2 | | | | |
| FR3 | | | | |
| FR4 | | | | |
| FR5 | | | | |
| FR6 | | | | |
| FR7 | | | | |
| FR8 | | | | |
| FR9 | | | | |
| FR10 | | | | |
| FR11 | | | | |
| FR12 | | | | |
| FR13 | | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
