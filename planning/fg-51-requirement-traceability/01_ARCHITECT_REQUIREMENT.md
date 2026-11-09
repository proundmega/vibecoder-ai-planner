# 01 — Requirement (fg-51)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), exact file operations
> (`04`), deferred table (`00`).

## Problem

A planning suite says `FR1` must do X and `03` says a test will prove it. After
implementation, nobody checks that the test exists, that it ran, or that it
actually asserts the requirement. The reviewer sees a diff; the human sees a
green build. Neither sees:

```text
FR1  spec ✓  code ✓  test ✓  verified ✓
FR2  spec ✓  code ✓  test ✗  verified ✗
FR3  spec ✓  code ✗  test ✗  verified ✗
```

`fg-48` validates the planning documents (matrix coverage, status claims,
placeholders). It does not link a requirement to the implementation or to a
test result. Code coverage percentages are not a substitute: a requirement can
be “covered” by a test that never asserts its acceptance condition.

## Goals

1. Build a stable requirement registry from `01` (`FR*`/`NFR*` + acceptance).
2. Collect explicit requirement → code and requirement → test mappings.
3. Ingest machine-readable test and verification evidence for the reviewed SHA.
4. Produce a per-requirement traceability matrix and a factual gap report.
5. Gate `review -> human_approval` and merge on missing/partial requirements,
   with scoped waivers.
6. Feed gaps to the reviewer and fixer so the loop fixes the right requirement.
7. Keep the check deterministic, offline by default and read-only for the
   repository/approval state; an agent may trigger recompute but cannot mutate
   code, tests, commits or approvals.

## Non-goals

- Judging whether the code semantically satisfies the requirement; that stays
  reviewer and human work.
- Inferring mappings from prose or embeddings.
- Generating tests automatically (deferred, `00` D2).
- Replacing `fg-48` (planning docs), `fg-31` (review + verification) or the
  human gate.
- A composite readiness score; the report is counts and rows.
- Cross-repository or cross-ticket traceability (deferred, `00` D4).

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence | State |
|---|---|---|---|---|
| A1 | Authors will annotate code/tests or maintain a manifest | Most requirements report `partial`; the gate blocks until mappings exist | Pilot suite; reviewer spot-check; `fg-37` calibration | open |
| A2 | CI/test results are available in machine-readable form | Traceability falls back to supervisor verification and reports `partial` | Report adapter tests; pilot CI artifacts | open |
| A3 | Requirement IDs stay stable after plan approval | A rename would attach evidence to the wrong requirement | `fg-45` `replan` rule; registry tests | open |
| A4 | A requirement is scoped to one ticket/PR head | Cross-PR requirements look `partial`; cross-PR work is deferred | Phase 1 scope; `00` D4 | open |

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Requirement registry: parse `FR*`/`NFR*` IDs and acceptance statements from `01`; reject duplicates and requirements without acceptance. | A fixture with duplicate/missing-acceptance IDs fails; a clean fixture yields one row per requirement. |
| FR2 | Mapping declaration: accept an explicit mapping from a `traceability.json` manifest and from code/test annotations (`@req FR1`, `[FR1]`); never infer from prose. | A requirement with a manifest mapping and one with an annotation both resolve; an unmapped requirement reports `missing`. |
| FR3 | Test evidence: ingest machine-readable reports (JUnit XML, Jest/Vitest JSON, pytest JSON) and match test cases to requirement IDs. | A passing test annotated `FR1` marks FR1’s test evidence present; a failing/absent test does not. |
| FR4 | Verification evidence: consume the supervisor verification result (`fg-31`/`VerificationRunner`) and CI results, recording command, exit code, SHA and timestamp. | A requirement covered by a passing verification command records `verified`; a failed/timed-out command records `partial`/`missing`. |
| FR5 | Trace model: persist one row per requirement with code refs, test refs, verification refs, status (`verified`, `partial`, `missing`, `waived`), evidence SHA and computed time. | Recomputing the same SHA is idempotent; a new SHA replaces the snapshot for that head. |
| FR6 | Gap report: return per-requirement rows plus counts (verified/partial/missing/waived); no composite score. | The report lists each requirement and its missing evidence; counts equal the rows. |
| FR7 | Merge gate: before `review -> human_approval` and before merge, block non-waived `missing`/`partial` requirements; modes `off|warn|enforce`, default `warn`. | In `enforce`, a missing-test requirement blocks the transition; in `warn` it records the gap and allows. |
| FR8 | Waiver: waive named requirement IDs with permission, reason, expiry and audit; separate from the `fg-45` readiness override. | A scoped, unexpired waiver allows that requirement; other gaps still block; the audit row exists. |
| FR9 | Reviewer/fixer integration: `fg-31` includes the gap report in review context; `fg-32` fix requests list missing/partial requirement IDs; re-review recomputes. | A fix request names the requirement IDs; after a fix push the snapshot is recomputed for the new SHA. |
| FR10 | UI and observability: a traceability panel on the ticket and an event row per computation with `run_id`/ticket correlation. | The panel shows counts and per-requirement evidence; an event is queryable by ticket and `run_id`. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Deterministic and offline by default; no network/LLM calls in the default check. | Two runs over the same inputs produce the same report; no external process starts. |
| NFR2 | No secrets in reports, prompts, logs or stored evidence. | Redaction tests pass; tokens/keys never appear in a row or event. |
| NFR3 | Read-only for the repository and approval state: the reviewer/agent path cannot mutate code, tests, commits or approvals; the trace service may write its own snapshot/event rows for recompute. | Permission/tests prove the agent path cannot mutate the repository or approve; recompute writes only trace/event rows. |
| NFR4 | Bounded: cap report size and parsing time; a too-large/unparseable report fails with a recorded reason, not an unbounded run. | A large fixture terminates within the configured cap and records `report_capped`. |
| NFR5 | Backward compatible: grandfather existing tickets; the gate is disabled/warn until enabled per project. | Existing tickets without snapshots are not blocked; enabling `enforce` is explicit. |

## Acceptance criteria

1. A fixture ticket with `FR1` code + test + passing verification reports `verified`; `FR2` with code but no test reports `partial`; `FR3` with no code reports `missing`.
2. The gap report shows the exact counts and one row per requirement; no percentage score.
3. In `enforce` mode, `review -> human_approval` and the merge gate block on non-waived gaps; in `warn` they record the gap and allow.
4. A scoped waiver with reason/expiry/audit allows only the named requirement; other gaps still block.
5. The reviewer context and fix request include the gap rows; a fix push recomputes for the new SHA.
6. Stale snapshots (different SHA) are rejected by the merge gate.
7. The UI panel and event stream expose the same data as the API.
8. Unit/contract tests use fixtures and fake reports; no real network calls.

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| API | New read endpoint for the gap report; `fg-31`/`fg-36` consume it | `backend/src/api/v1/` |
| Database | New `ticket_requirement_trace` table + rollback; no change to existing tables | `backend/src/migrations/` |
| Frontend | New traceability panel on `TicketDetail`; counts and per-requirement rows | `frontend/src/views/TicketDetail.vue` |
| Agent | Review/fixer context gains the gap report; verification result is passed through | `agent/src/main/java/com/vibecode/agent/harness/` |
| Permissions/auth | Read uses `TICKET_READ`; waivers use a new `TICKET_TRACEABILITY_WAIVE` permission + project membership | `middleware/permissions.js` |
| Background jobs | No new worker; computation runs at review completion/fix push and on demand | `fg-31`/`fg-32` |
| Downstream tickets | `fg-31`, `fg-32`, `fg-36`, `fg-41`, `fg-45`, `fg-48` | see `00` dependencies |
| Rollback | Disable the gate (`off`), keep the table; no data loss | flag + migration rollback |

## Important design decisions

1. Requirement IDs are the contract. No prose parsing or embedding-based inference.
2. A requirement is `verified` only with code + test + passing verification at the reviewed SHA; code coverage is not evidence.
3. The report is counts and rows, never a composite score.
4. The gate runs inside the existing `review -> human_approval` and merge lifecycle, not a new phase.
5. Waivers are scoped to requirement IDs, with reason/expiry/audit; they are not a blanket “merge anyway”.
6. The default is `warn`, so rollout does not freeze existing work.

## Known unknowns

- How many tickets will adopt annotations vs a manifest; the pilot decides the default.
- Whether the supervisor verification result can be mapped to individual requirements or only to the whole suite; Phase 1 allows suite-level evidence with a `partial` status.
- Whether CI test reports are available for every language in the repo; missing reports fail closed only in `enforce`.
- How to handle requirements implemented across multiple PRs; Phase 1 scopes evidence to the ticket/PR head.

## Testing checklist

- [ ] Registry: duplicate IDs, missing acceptance, non-sequential IDs.
- [ ] Mapping: manifest, code annotation, test-name annotation, unmapped requirement.
- [ ] Reports: JUnit XML, Jest/Vitest JSON, pytest JSON; malformed/oversized report.
- [ ] Status rules: verified/partial/missing/waived; new SHA replaces the snapshot.
- [ ] Gate: `off`/`warn`/`enforce`; `review -> human_approval`; merge gate; stale SHA.
- [ ] Waiver: permission, project membership, reason, expiry, audit, revocation.
- [ ] Reviewer/fixer: gap rows in context; fix request IDs; re-review recomputes.
- [ ] UI/event: panel matches API; event carries ticket/`run_id`.
- [ ] Redaction: no secret in report/prompt/log/row.
- [ ] Backfill/grandfather: existing tickets are not blocked.

## Out of scope

- Semantic correctness of code vs requirement.
- Test generation.
- Cross-repo/cross-ticket traceability.
- Code coverage aggregation or dashboards.
- Replacing `fg-48`, `fg-31`, `fg-32`, `fg-36` or the human gate.
- Auto-approval/auto-merge.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep
a copy.
