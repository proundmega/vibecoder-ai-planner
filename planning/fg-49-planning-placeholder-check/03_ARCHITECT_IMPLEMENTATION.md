# 03 — Implementation (fg-49)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), status (`00`).

## Plan

1. **Checker scan** — add the status-scoped active-suite scan, fenced-code and
   Results exclusions, and the legacy report to `planning/check-planning.js`;
   keep the already-added `lightweight` exemption — verify:
   `node planning/check-planning.js`.
2. **Regression tests** — extend the pre-seeded self-check test with fixtures
   for an in-progress suite, a planned suite, a `DONE/` suite, a legacy suite,
   a fenced example and the Results table — verify:
   `node --test planning/check-planning.test.js`.
3. **Repository self-check** — add a test that runs the checker against the
   repository root and asserts exit 0 — verify:
   `node --test planning/check-planning.test.js`.
4. **Documentation** — document the scope, exemptions and expected output in
   `planning/README.md` — verify: `node planning/check-planning.js`.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `planning/check-planning.js` | MODIFY | Scan `in_progress`/`in_review`/`done` migrated suites for `{{...}}`; ignore fenced blocks, inline code and the Results table; report active legacy suites; keep the existing `lightweight` exemption |
| `planning/check-planning.test.js` | MODIFY | Extend the pre-seeded repository self-check with fixtures for active/planned/DONE/legacy suites, fenced examples and Results |
| `planning/README.md` | MODIFY | Document the placeholder scope, exemptions and expected output |

## Dependencies

- `fg-48` remains the owner of evidence/claim checks; this ticket only adds
  structural placeholder detection.
- `fg-50` owns migration and retired-wording checks for legacy suites; this
  ticket reports them but does not scan them.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Node script | `planning/check-planning.test.js` | `FR1 in-progress suite with {{DATE}} fails`; `FR1 planned suite with {{DATE}} passes` | `node --test planning/check-planning.test.js` |
| FR2 | Node script | `planning/check-planning.test.js` | `FR2 failure names suite path, line and token` | `node --test planning/check-planning.test.js` |
| FR3 | Node script | `planning/check-planning.test.js` | `FR3 DONE/archived/lightweight/legacy fixtures pass and are reported separately` | `node --test planning/check-planning.test.js` |
| FR4 | Node script | `planning/check-planning.test.js` | `FR4 04/05 placeholder fails`; `FR4 fenced/inline examples and Results placeholder pass` | `node --test planning/check-planning.test.js` |
| FR5 | Node script | `planning/check-planning.test.js` | `FR5 repository self-check exits 0` | `node --test planning/check-planning.test.js` |
| NFR1 | Node script | `planning/check-planning.test.js` | `NFR1 repeated runs are deterministic and offline` | `node --test planning/check-planning.test.js` |

## Verification commands

```bash
node planning/check-planning.js
node --test planning/check-planning.test.js
```

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | pending | pending | pending | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
