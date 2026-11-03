# 03 — Implementation (fg-47)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

Ordered slices. Each slice is independently verifiable.

1. **Schema and config** — add `review_pass`, `parent_attempt_id`,
   `trigger_reason`, `prompt_version`; migrate the completed-attempt unique
   index to include `review_pass`; add `SECOND_REVIEW_*` config. Verify:
   migration/rollback + config tests.
2. **Second-pass runner** — run the reviewer with a different
   model/provider, a separate workspace/context and read-only tools. Verify:
   the runner cannot write/merge; a model fallback is recorded.
3. **Trigger and cost caps** — implement `SECOND_REVIEW_TRIGGER`, token/time
   caps and skip reasons. Verify: high-risk/disagreement trigger; cap-exceeded
   path.
4. **Aggregation and blocking** — dedupe by stable key, max severity, merge
   evidence, advisory vs blocking. Verify: one finding per key; advisory does
   not gate; disagreement escalates.
5. **Fix-loop integration** — create/extend one `fg-32` fix request; re-review
   the new SHA with both passes; keep `FIX_MAX_ROUNDS`. Verify: no duplicate
   fix request; bounded rounds.
6. **Observability** — emit per-pass events/metrics and a review record.
   Verify: pass/model/tokens/duration/findings are queryable; `fg-41` can
   correlate them.
7. **Tests and docs** — unit/contract tests, a calibration fixture, README/env
   docs, and the rollout flags.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/NNN_review_pass.sql` | CREATE | Add pass/trigger/prompt columns; replace the completed-attempt unique index. |
| `backend/src/migrations/NNN_review_pass_rollback.sql` | CREATE | Restore the original index and drop the columns. |
| `backend/src/services/ReviewService.js` | MODIFY | Pass discriminator, trigger decision, aggregation, escalation. |
| `backend/src/services/ReviewAggregator.js` | CREATE | Dedupe/merge findings; blocking policy. |
| `backend/src/api/review.js` | MODIFY | Second-pass query/trigger/escalation contract. |
| `agent/src/main/java/.../SecondReviewProcessor.java` | CREATE | Read-only second-pass runner. |
| `agent/src/main/java/.../ReviewPrompt.java` | MODIFY | Second-pass rubric/version. |
| `backend/src/__tests__/reviewPass.test.js` | CREATE | Schema, trigger, aggregation, blocking, caps. |
| `backend/src/__tests__/integration/reviewPass.test.js` | CREATE | Real Postgres/HTTP pass lifecycle. |

## Dependencies

- `fg-31` — primary reviewer, attempts/findings schema, read-only harness.
- `fg-32` — fix requests, rounds, escalation.
- `fg-34` — sandbox for the second-pass runner.
- `fg-37` — calibration corpus and false-positive measurement.
- `fg-41` — events/metrics correlation.
- `fg-38` — hard cost caps when available.

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | backend unit | `backend/src/__tests__/reviewPass.test.js` | mode off/advisory/blocking | `npm test` |
| FR2 | agent/contract | `agent/src/test/.../SecondReviewProcessorTest.java` | read-only, separate identity/context | `mvn test` |
| FR3 | backend unit | `backend/src/__tests__/reviewPass.test.js` | different model/provider + fallback | `npm test` |
| FR4 | backend integration | `backend/src/__tests__/integration/reviewPass.test.js` | pass/model/prompt/evidence persisted | `npm run test:integration` |
| FR5 | backend unit | `backend/src/__tests__/reviewPass.test.js` | dedupe, max severity, both evidence sets | `npm test` |
| FR6 | backend unit | `backend/src/__tests__/reviewPass.test.js` | blocking gates; advisory does not | `npm test` |
| FR7 | backend integration | `backend/src/__tests__/integration/reviewPass.test.js` | fix -> new SHA -> both passes re-review | `npm run test:integration` |
| FR8 | backend unit | `backend/src/__tests__/reviewPass.test.js` | trigger matrix + token/time caps | `npm test` |
| FR9 | backend unit | `backend/src/__tests__/reviewPass.test.js` | per-pass events/metrics fields | `npm test` |
| FR10 | backend unit | `backend/src/__tests__/reviewPass.test.js` | disagreement/security/cap escalation | `npm test` |
| NFR1 | agent/contract | `agent/src/test/.../SecondReviewProcessorTest.java` | no write/merge/approve tools | `mvn test` |
| NFR2 | backend unit | `backend/src/__tests__/reviewPass.test.js` | secret redaction on capture/storage | `npm test` |
| NFR3 | backend unit | `backend/src/__tests__/reviewPass.test.js` | prompt/model/trigger version recorded | `npm test` |
| NFR4 | backend unit | `backend/src/__tests__/reviewPass.test.js` | cap-exceeded terminates without retry | `npm test` |

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | primary / second | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] The completed-attempt unique index includes `review_pass`
- [ ] The second pass cannot write, push, merge or approve
- [ ] Aggregation preserves both evidence sets and escalates disagreement
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `check-planning.js` passes; no status/claim/index mismatch
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run |
