# 01 — Requirement (fg-48)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

Planning docs make claims that are easy to get wrong and expensive to review
manually:

- a suite says `done` while only the plan is merged;
- `PENDING.txt` says `Merged` for a planning-only PR;
- prose says "the one open follow-up is D6" while the register lists D1-D7;
- a verification matrix omits a requirement;
- a done suite keeps empty results or `To be filled in` placeholders;
- a "stale" reference points at a section or path that no longer exists.

`check-planning.js` now catches the structural invariants (status/pr, matrix
coverage, dated results for `done`, index labels). A dedicated `check-claims`
script can go further by validating a structured evidence table and a small set
of high-value heuristics.

**Design constraint:** do not attempt to understand prose. A green check means
the structured claims are consistent, not that the design is correct. Prose
semantics and design quality remain reviewer/human work.

## Goals

1. Make status/implementation claims machine-checkable through a small
   evidence table.
2. Verify index labels (`Plan merged` vs `Merged`) against `00`.
3. Verify matrix coverage and non-placeholder results for `done` suites.
4. Detect cheap contradictions such as "one open follow-up" vs the register.
5. Keep the checker deterministic, fast, read-only and network-free by default.
6. Run alongside `check-planning.js` in CI/pre-commit once stable.

## Non-goals

- NLP/prose claim extraction.
- Judging design correctness, security or product intent.
- Auto-fixing labels or prose.
- Replacing the independent reviewer or human gate.
- Resolving GitHub PRs/commits over the network by default.
- Checking legacy suites without frontmatter.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Parse the canonical inputs: `00` frontmatter + Status evidence table, `03` Results/matrix, `00` deferred register, `PENDING.txt` and `HARNESS_ROADMAP.md`. | A fixture with each input is parsed into a normalized model; a missing required input is reported with the file. |
| FR2 | Enforce status invariants: `done` requires an implementation PR, dated Results and matrix coverage; `planned`/`deferred` must not claim an implementation; `in_review` requires a PR. | Bad fixtures produce the expected rule failures; good fixtures pass. |
| FR3 | Validate the Status evidence table: every row has a claim, evidence and checked state; evidence is `pending`, `n/a`, `PR #N`, `commit <sha>` or a local path. | Unknown evidence syntax is a warning; a checked claim with `pending` evidence is a failure. |
| FR4 | Verify index labels: planned/deferred rows may say `Planned` or `Plan merged`, never bare `Merged`; done rows must say `Merged`, not `Plan merged`/`Planned`. | `PENDING.txt` and `HARNESS_ROADMAP.md` fixtures fail on mismatched labels. |
| FR5 | Verify matrix coverage: every `FR*`/`NFR*` in `01` has a row in `03`; duplicate IDs are reported. | Fixtures with a missing/duplicate requirement fail. |
| FR6 | Verify deferred-register claims: parse D-IDs/states; detect prose claims like "one open follow-up" that contradict the count; warn when a referenced follow-up ticket is missing. | A fixture with seven open rows and "one open follow-up" fails; a matching claim passes. |
| FR7 | Detect placeholders in `done` suites: empty matrix rows, empty/`Not run` Results, "to be filled in when implementation starts". | Done fixtures with placeholders fail; planned fixtures may keep placeholders. |
| FR8 | Verify referenced local paths in evidence: a path marked as existing must exist; `pending`/`create` paths are allowed. | A missing evidence path fails; a future path marked pending passes. |
| FR9 | Emit stable rule IDs (`C1`…), `file:line`, severity (`fail`/`warn`) and a non-zero exit on failure; support a `--json` mode. | CLI output matches the fixture expectations; fail exits non-zero. |
| FR10 | Integrate with the planning check: run alongside `check-planning.js`; no LLM/network by default; optional PR/commit resolution behind an explicit flag. | CI/pre-commit command runs both; default mode makes no network call. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Deterministic and fast: no LLM, no network by default, bounded file reads. | Same inputs produce the same output; a normal repo run completes in seconds. |
| NFR2 | Read-only: never rewrites docs, indexes or code. | The script has no write calls; tests assert files are unchanged. |
| NFR3 | Legacy-safe: skip suites without YAML frontmatter; do not fail the historical backlog. | A legacy fixture is skipped with a note. |
| NFR4 | Low false-positive rate: hard rules fail; heuristics warn; a `--strict` flag can promote warnings. | Default run on the migrated suites is clean; heuristic deviations are warnings. |

## In scope

- A standalone `planning/check-claims.js` CLI.
- A small shared parser/rule library with fixtures.
- A documented Status evidence syntax.
- CI/pre-commit integration after a warn-only rollout.
- Tests for good/bad suites and index fixtures.

## Out of scope

Summarise only. The authoritative list is `00` → Deferred register.

- NLP/prose extraction — `00` D1.
- GitHub PR/commit resolution — `00` D2.
- Design/security correctness — `00` D3.
- Auto-fixing — `00` D4.
- Jenkins wiring — `00` D5.

## Dependencies

- Depends on: `fg-47` (review policy/evidence expectations), `fg-31` (review
  vocabulary).
- Consumes: `planning/check-planning.js` conventions and the `00`/`03`
  templates.
- Blocks: no other ticket; supports `fg-47` and all planning reviews.
