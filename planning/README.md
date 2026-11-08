# Planning Suites

One folder per ticket: `planning/<id>-<slug>/`. A suite is a small set of
documents with **one owner per fact** — no fact is copied into a second file.

## Document set

| File | Required | Owns (the only place this lives) |
|---|---|---|
| `00_ARCHITECT_CHECKLIST.md` | yes | status, dates, PR/branch, **status evidence**, readiness gate, **deferred register**, user decisions |
| `01_ARCHITECT_REQUIREMENT.md` | yes | problem, goals/non-goals, numbered `FR*`/`NFR*`, acceptance |
| `02_ARCHITECT_DESIGN.md` | yes | current-state audit, design, data model, contracts, risks, review focus, rollout |
| `03_ARCHITECT_IMPLEMENTATION.md` | yes | work order, per-file changes, **verification matrix**, review record, results |
| `04_SPECIFICATION.md` | optional | exact file operations for an implementation agent |
| `05_RUNBOOK.md` | optional | operational procedures (health, recover, dead-letter, rollback) |

`ENGINEERING_STANDARDS.md` holds the repo-wide rules (paths, commands, test
layers, coverage, API conventions). Templates link to it instead of restating
it.

For a small, single-layer ticket (one layer, no API/DB contract, auth,
migration or agent-boundary change), copy `planning/lightweight/00` and
`planning/lightweight/03` instead of the full `00`–`03` set. Requirements live
in the lightweight `00`; `01` and `02` are intentionally omitted.

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

## Review policy

Every planning or implementation change goes through the same layered gate.
The layers are independent: a change can pass one and fail another.

| Layer | Owner | What it checks | Gate |
|---|---|---|---|
| 0. Deterministic | CI / `check-planning.js` | structure, status, matrix coverage, results, tests, lint, paths | blocking |
| 1. Author self-check | author | `03` review checklist, evidence, results | blocking |
| 2. Pre-implementation risk review | `fg-45` (planned) | assumptions, failure modes, security considerations, change impact present and actionable | blocking before plan approval/pickup |
| 3. Independent reviewer | reviewer agent (`fg-31`) | requirements/design/code against evidence | blocking findings |
| 4. Second reviewer | `fg-47` (planned) | different model/provider/context; adversarial pass | blocking findings |
| 5. Fixer | separate fixer (`fg-32`) | resolve blocking findings, hand back the new SHA | bounded rounds |
| 6. Traceability | `fg-51` (planned) | every `FR*`/`NFR*` maps to code, a test and passing verification at the reviewed SHA; gap report | blocking before human approval/merge |
| 7. Human | human | final approval, security, architecture, product intent | blocking |

Rules:

- **Reviewer ≠ author.** A reviewer is a separate session/agent, read-only,
  with no access to the author's chain-of-thought. See `fg-31`.
- **Evidence, not assertion.** Every finding needs a file:line, a failing
  command/test, or a cited rule. Findings without evidence are non-blocking.
- **Only blocking findings gate.** Classify severity; do not ping-pong on
  non-blocking nits. Record the resolution in `03`.
- **Bounded loop.** `fg-32` allows two fix rounds after round 0. Escalate on
  no progress, repeated findings, a moved remote head, or a disagreement about
  intent.
- **No self-approval.** Reviewer and fixer cannot merge or approve; the human
  gate decides.
- **Model diversity is a decorrelator.** A same-model review in a fresh
  context is useful; the second pass (`fg-47`) should use a different model
  family/provider where available.
- **Claims must match state.** If a document says "implemented", "merged",
  "done", or "N open follow-ups", it must cite the evidence. A planning PR is
  **plan merged**, never `done`. The index labels in `PENDING.txt` and
  `HARNESS_ROADMAP.md` must match `00`.
- **Risk before code.** No ticket starts implementation until its assumptions,
  change impact and (for non-small work) failure modes and security
  considerations are present and approved. This is a readiness check, not a
  new phase.
- **Traceability before merge.** No ticket reaches `human_approval` or merge
  with an unresolved `missing`/`partial` requirement unless a scoped,
  reason-bearing, expiring waiver is recorded. Code coverage is not
  requirement coverage.
- **AI drafts, humans ratify.** An agent may draft risk sections or propose
  mappings, but it cannot mark an assumption validated, waive a gap or approve
  the plan.

### Pre-implementation risk review (`fg-45`)

Before plan approval and pickup:

- `01` carries an **Assumptions** table (assumption, impact if wrong,
  validation/evidence) and a **Change impact** table (API, DB, frontend,
  agent, permissions, jobs, downstream, rollback).
- `02` carries **Failure modes and recovery** and **Security considerations**
  for `architecture`, `technical` and `specification` tickets.
- The deterministic check verifies that the sections exist, are non-empty and
  contain no placeholders. The independent reviewer and the human decide
  whether each row is real and testable.
- A small fix follows the reduced path: a one-line assumptions statement and
  change impact may be `n/a` with a reason; no failure-mode/security tables
  unless the fix touches auth, permissions, migrations, the agent boundary,
  external calls or secrets.

### Requirement traceability (`fg-51`)

Before `review -> human_approval` and before merge:

- Every `FR*`/`NFR*` must map to code, at least one test and passing
  verification evidence at the reviewed SHA.
- The report is per-requirement rows plus counts (`verified`, `partial`,
  `missing`, `waived`), not a composite percentage.
- A suite-level green run without a mapped test is `partial`, not `verified`.
- Missing/partial requirements block in `enforce`; waivers name specific
  requirement IDs and carry a reason, expiry, permission and audit row.

### Claim verification

`00` carries a short **Status evidence** table (claim → evidence). Keep it
factual and machine-checkable; do not use prose that the checker cannot
resolve. Existing `planned` suites may add it when they move to
`in_progress`; a `done` suite must have it. `planning/check-planning.js`
verifies the structural claims now. The future `fg-48` `check-claims` script
will verify the evidence table, index labels, matrix coverage and results
without trying to interpret design prose.

## Status vocabulary

| `00` status | Meaning | Index label |
|---|---|---|
| `planned` | docs complete, not implemented | `Planned` or `Plan merged (#N); implementation pending` |
| `in_progress` | implementation started | `In progress` |
| `in_review` | implementation PR open | `In review (#N)` |
| `done` | implementation merged | `Merged (#N)` |
| `deferred` | deliberately not scheduled | `Deferred` |

`done` requires the implementation PR/commit, a dated `03` Results row and
verification evidence. A merged planning PR leaves the suite `planned`.

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

1. Copy `00`–`03` (and `04` if an implementation agent needs exact file
   operations) into the new folder. For a lightweight ticket, copy
   `planning/lightweight/00` and `planning/lightweight/03` instead.
2. Fill `00` first: id, title, status, dependencies, status evidence.
3. Write `01` before `02`, and `02` before `03`. Fill the assumptions and
   change-impact tables in `01`; fill the failure-mode and security sections
   in `02` (non-small tickets).
4. Name tests with their requirement ID (`FR1`) so requirement traceability
   can map code → test → verification.
5. Fill the deferred register in `00` as decisions are made.
6. Keep `PENDING.txt` and `HARNESS_ROADMAP.md` as indexes only — they
   summarise, they do not become a second copy of the register.
7. Run `node planning/check-planning.js` and record the first review round in
   `03`.

## Check

Run the conformance check before opening a PR:

```bash
node planning/check-planning.js
```

It checks migrated suites (those with YAML frontmatter in `00`) for the rules
above: a single deferred register, no `Status:` lines outside `00`, no legacy
`Pending Scope` sections, numbered requirements in `01`, a verification-matrix
row for every `FR*`/`NFR*`, and status evidence (a `done` suite must have a PR,
a dated Results row and no placeholders; a `planned` suite must not claim an
implementation). It also checks that `PENDING.txt` and `HARNESS_ROADMAP.md`
labels agree with `00` (`Plan merged` vs `Merged`). Legacy suites are skipped,
so the historical backlog does not fail.

`fg-48` plans a richer `check-claims` script for structured evidence tables
and PR/commit references. It is deliberately separate: `check-planning.js`
checks invariants; `check-claims` will check claims that can be expressed as
evidence, not design prose.

## Migrating an older suite

Older suites duplicate the pending-scope table in `01`/`02`/`03`/`04`, restate
acceptance in `04`, and carry a status line in every file. To migrate:

1. Merge every unique deferred item from those tables into `00`'s register.
2. Replace the copies with `See 00 → Deferred register.`
3. Delete the `04` acceptance/out-of-scope copies; link to `01`/`00`.
4. Delete status/date lines from `01`–`04`; keep them only in `00`.
5. Leave `DONE/` and `archived/` untouched — they are historical records.
