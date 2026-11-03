# 03 — Implementation (fg-48)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

Ordered slices. Each slice is independently verifiable.

1. **Rule spec + fixtures** — write good/bad fixture suites for C1-C13; no
   production code yet. Verify: fixtures reproduce each expected message.
2. **Shared parser** — extract frontmatter/table/section/index parsing from
   `check-planning.js` into `planning/lib/planning.js`; keep
   `check-planning.js` behavior unchanged. Verify: existing check still passes.
3. **Hard rules** — C1-C8: status/pr, matrix coverage, index labels, evidence
   completeness, done placeholders, missing existing evidence paths. Verify:
   fixtures fail/pass as expected.
4. **Heuristics** — C9-C13: pending/ambiguous paths, follow-up counts, remote
   refs, duplicate IDs, column counts. Verify: default warnings, `--strict` fails.
5. **CLI/output** — human and `--json` output, exit codes, `--strict`,
   `--resolve-remote`. Verify: golden output tests.
6. **Rollout** — run warn-only against the migrated suites; fix the repo; then
   document the CI/pre-commit command. Verify: clean run on `planning/`.
7. **Docs** — update `planning/README.md` and the review checklist with the
   command and the evidence syntax.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `planning/lib/planning.js` | CREATE | Shared frontmatter/table/section/index parser. |
| `planning/check-planning.js` | MODIFY | Use the shared parser; behavior unchanged. |
| `planning/check-claims.js` | CREATE | CLI, rule registry, output, exit codes. |
| `planning/check-claims.test.js` | CREATE | Fixture-driven rule tests. |
| `planning/fixtures/claims/` | CREATE | Good/bad suite and index fixtures. |
| `planning/README.md` | MODIFY | Evidence syntax, command, limitations. |
| `Jenkinsfile` | MODIFY | Run both checks in the docs/planning stage. |
| `planning/00_ARCHITECT_CHECKLIST.md` | MODIFY | Keep the Status evidence table; link the command. |
| `planning/03_ARCHITECT_IMPLEMENTATION.md` | MODIFY | Add the claim-check command to the review checklist. |

## Dependencies

- `fg-47` — review policy/evidence expectations.
- `fg-31` — review vocabulary (pass, findings, blocking).
- `planning/check-planning.js` — existing structural checks and conventions.
- No production backend/agent dependency.

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | tool unit | `planning/check-claims.test.js` | parse all canonical inputs | `node planning/check-claims.test.js` |
| FR2 | tool unit | `planning/check-claims.test.js` | status invariants for planned/in_review/done | `node planning/check-claims.test.js` |
| FR3 | tool unit | `planning/check-claims.test.js` | evidence syntax + checked/pending | `node planning/check-claims.test.js` |
| FR4 | tool unit | `planning/check-claims.test.js` | PENDING/roadmap label mismatch | `node planning/check-claims.test.js` |
| FR5 | tool unit | `planning/check-claims.test.js` | missing/duplicate matrix rows | `node planning/check-claims.test.js` |
| FR6 | tool unit | `planning/check-claims.test.js` | register count vs prose | `node planning/check-claims.test.js` |
| FR7 | tool unit | `planning/check-claims.test.js` | done placeholders | `node planning/check-claims.test.js` |
| FR8 | tool unit | `planning/check-claims.test.js` | evidence path exists/pending | `node planning/check-claims.test.js` |
| FR9 | tool unit | `planning/check-claims.test.js` | JSON/exit codes/rule IDs | `node planning/check-claims.test.js` |
| FR10 | integration | `planning/check-claims.test.js` | default no-network + CI command | `node planning/check-claims.js --json` |
| NFR1 | tool unit | `planning/check-claims.test.js` | deterministic, no network | `node planning/check-claims.test.js` |
| NFR2 | tool unit | `planning/check-claims.test.js` | files unchanged | `node planning/check-claims.test.js` |
| NFR3 | tool unit | `planning/check-claims.test.js` | legacy suite skipped | `node planning/check-claims.test.js` |
| NFR4 | tool unit | `planning/check-claims.test.js` | warnings only by default; strict fails | `node planning/check-claims.test.js` |

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | primary / second | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] The checker is read-only and network-free by default
- [ ] Legacy suites are skipped
- [ ] Hard rules fail; heuristics warn; `--strict` promotes warnings
- [ ] No secret, `.env`, `Jenkinsfile` (except the CI stage), or unrelated file touched
- [ ] `check-planning.js` passes; no status/claim/index mismatch
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00`

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run |
