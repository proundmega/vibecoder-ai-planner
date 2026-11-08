# 03 — Implementation (fg-49)

> **Owns:** work order, per-file changes, verification matrix, review record,
> results.
> **Not here:** design rationale (`02`), status (`00`).

## Plan

1. **Checker scan** — extend `planning/check-planning.js` with the active-suite
   placeholder scan and `lightweight` exemption — verify: `node planning/check-planning.js`.
2. **Regression tests** — add fixtures for an active suite, a `DONE/` suite and
   the lightweight template directory — verify: `node --test planning/check-planning.test.js`.
3. **Documentation** — document the check in `planning/README.md` — verify:
   `node planning/check-planning.js`.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `planning/check-planning.js` | MODIFY | Add `lightweight` to `SKIP`; scan active `00`–`05` files for `{{...}}`; report suite/file/line/token |
| `planning/check-planning.test.js` | CREATE | Node test fixtures for active failure and exempt directories |
| `planning/README.md` | MODIFY | Document the placeholder check and expected output |

## Dependencies

- `fg-48` remains the owner of evidence/claim checks; this ticket only adds
  structural placeholder detection.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Node script | `planning/check-planning.test.js` | active suite with `{{DATE}}` fails | `node --test planning/check-planning.test.js` |
| FR2 | Node script | `planning/check-planning.test.js` | failure names file, line and token | `node --test planning/check-planning.test.js` |
| FR3 | Node script | `planning/check-planning.test.js` | `DONE/`, `archived/` and `lightweight/` fixtures pass | `node --test planning/check-planning.test.js` |
| FR4 | Node script | `planning/check-planning.test.js` | placeholder in `04`/`05` fails | `node --test planning/check-planning.test.js` |
| NFR1 | Node script | `planning/check-planning.test.js` | repeated runs are deterministic and offline | `node --test planning/check-planning.test.js` |

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
| {{YYYY-MM-DD}} | {{sha}} | {{checker tests}} | {{pass/fail}} |
