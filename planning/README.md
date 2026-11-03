# Planning Suites

One folder per ticket: `planning/<id>-<slug>/`. A suite is a small set of
documents with **one owner per fact** — no fact is copied into a second file.

## Document set

| File | Required | Owns (the only place this lives) |
|---|---|---|
| `00_ARCHITECT_CHECKLIST.md` | yes | status, dates, PR/branch, readiness gate, **deferred register**, user decisions |
| `01_ARCHITECT_REQUIREMENT.md` | yes | problem, goals/non-goals, numbered `FR*`/`NFR*`, acceptance |
| `02_ARCHITECT_DESIGN.md` | yes | current-state audit, design, data model, contracts, risks, rollout |
| `03_ARCHITECT_IMPLEMENTATION.md` | yes | work order, per-file changes, **verification matrix**, results |
| `04_SPECIFICATION.md` | optional | exact file operations for a small model |
| `05_RUNBOOK.md` | optional | operational procedures (health, recover, dead-letter, rollback) |

`ENGINEERING_STANDARDS.md` holds the repo-wide rules (paths, commands, test
layers, coverage, API conventions). Templates link to it instead of restating
it.

## The rules

1. **One fact, one home.** The table above is binding. If another doc needs the
   fact, it links to the owner — it does not restate or paste the table.
2. **Requirements are numbered.** Every requirement is `FR1`, `FR2`, …, and
   every non-functional/safety requirement is `NFR1`, …. Acceptance criteria
   and tests reference those IDs. This is what makes conformance checkable.
3. **Deferred work is recorded once** in `00` → *Deferred register*. `01`'s
   out-of-scope section may summarise, but never duplicates the table. `02`
   and `04` do not carry a copy at all.
4. **Status lives in `00` frontmatter.** No other file carries a `Status:`
   line. Do not hand-edit "slice N implemented" prose; it goes stale.
5. **`04` refines, never repeats.** It contains exact file operations and test
   cases; it does not restate the requirement, the design, or acceptance.
6. **No placeholder sections kept "for completeness".** Delete a section that
   does not apply rather than leaving `[TBD]`.

## Lifecycle

```
planned → in_progress → in_review → done
                    ↘ deferred / cancelled
```

- `planned` — docs complete, not started.
- `in_progress` — implementation started; update `updated` when state moves.
- `in_review` — PR open.
- `done` — merged; move the folder to `planning/DONE/`.
- `deferred` — deliberately not scheduled; keep the reason in the register.

## Creating a suite

1. Copy `00`–`03` (and `04` if a small model will execute it) into the new
   folder.
2. Fill `00` first: id, title, status, dependencies.
3. Write `01` before `02`, and `02` before `03`.
4. Fill the deferred register in `00` as decisions are made.
5. Keep `PENDING.txt` and `HARNESS_ROADMAP.md` as indexes only — they
   summarise, they do not become a second copy of the register.

## Check

Run the conformance check before opening a PR:

```bash
node planning/check-planning.js
```

It checks migrated suites (those with YAML frontmatter in `00`) for the rules
above: a single deferred register, no `Status:` lines outside `00`, no legacy
`Pending Scope` sections, and numbered requirements in `01`. Legacy suites are
skipped, so the historical backlog does not fail.

## Migrating an older suite

Older suites duplicate the pending-scope table in `01`/`02`/`03`/`04`, restate
acceptance in `04`, and carry a status line in every file. To migrate:

1. Merge every unique deferred item from those tables into `00`'s register.
2. Replace the copies with `See 00 → Deferred register.`
3. Delete the `04` acceptance/out-of-scope copies; link to `01`/`00`.
4. Delete status/date lines from `01`–`04`; keep them only in `00`.
5. Leave `DONE/` and `archived/` untouched — they are historical records.
