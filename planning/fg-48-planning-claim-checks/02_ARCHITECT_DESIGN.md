# 02 — Design (fg-48)

> **Owns:** current-state audit, chosen design, data model, contracts, risks,
> rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), exact file
> operations (`04`), status and deferrals (`00`).

## Current state (the only infrastructure audit)

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Structural planning check | yes | `planning/check-planning.js` | Status/pr, matrix coverage, done Results, index labels |
| Status evidence table | template only | `planning/00_ARCHITECT_CHECKLIST.md` | Not parsed yet |
| Claim checker | no | — | No evidence/path/register checks |
| Index parsers | no | — | PENDING/roadmap labels are free text |
| CI hook | no | Jenkinsfile | Only `check-planning.js` is available |

**Key insight:** the easy checks are already in `check-planning.js`. This
ticket should not duplicate them; it should add the evidence table, path
references, deferred-register counts and a warn/fail policy on top.

## Feasibility

| Check | Difficulty | Automatable? | Notes |
|---|---|---|---|
| `done` vs implementation evidence | easy-medium | yes, with evidence table | Needs the PR/commit and Results |
| `Plan merged` vs `Merged` labels | easy | yes | Stable table rows |
| Matrix coverage | easy | yes | `01`/`03` table parse |
| Placeholders in `done` | easy | yes | Text/table parse |
| Evidence path exists | medium | yes | Allow `pending`/future paths |
| "one open follow-up" vs register | medium | yes, with a phrase pattern | Parse D-IDs/states |
| PR/commit existence | medium | optional | Network/auth; not default |
| Prose claim truth | hard | no | Reviewer/human |
| Design correctness | hard | no | Reviewer/human |

The design deliberately stops at the "medium" row. A script that tries to
interpret design prose will be noisy and will create false confidence.

## Design summary

Add a standalone `planning/check-claims.js` with a small rule registry:

- **Inputs:** `00` frontmatter + Status evidence, `03` Results/matrix, `00`
  deferred register, `PENDING.txt`, `HARNESS_ROADMAP.md`.
- **Rules:** hard invariants (`C1`…`C8`) and heuristic warnings (`C9`…`C13`).
- **Output:** human-readable lines plus `--json`; exit `1` on any `fail`.
- **Modes:** default (fail hard, warn heuristics), `--strict` (warnings fail),
  `--json`, optional `--resolve-remote` for PR/commit checks.
- **Shared code:** extract the frontmatter/table parsers from
  `check-planning.js` into a small `planning/lib/planning.js` so both CLIs use
  the same rules. Keep each CLI thin.

### Status evidence syntax

`00` carries a table:

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | `PR #104` | ☑ |
| Implementation merged | `pending` | ☐ |
| Verification results | `03 Results` | ☐ |

Accepted evidence tokens:

- `pending` — allowed for a planned suite; forbidden for a checked/done claim.
- `n/a` — allowed when the claim does not apply.
- `PR #123` — a PR reference; optional remote resolution.
- `commit <sha>` — a commit reference; optional remote resolution.
- A local path (for example `03` or `backend/src/...`) — must exist if marked
  checked and not prefixed with `pending:`/`create:`.

Anything else is a warning, not a hard failure. The checker does not infer
prose.

### Rule registry

| Rule | Severity | Check |
|---|---|---|
| C1 | fail | `done` has a PR and a dated, non-placeholder Results row |
| C2 | fail | `planned`/`deferred` has no `pr` and no "implementation merged" prose |
| C3 | fail | `in_review` has a PR |
| C4 | fail | Every `FR*`/`NFR*` in `01` has a matrix row |
| C5 | fail | `PENDING`/roadmap labels match `00` (`Plan merged` vs `Merged`) |
| C6 | fail | Status evidence rows are complete; a checked claim is not `pending` |
| C7 | fail | A `done` suite has no placeholder/empty results/matrix rows |
| C8 | fail | An evidence path marked as existing is missing |
| C9 | warn | An evidence path is pending/ambiguous, or a referenced follow-up ID is absent |
| C10 | warn | Prose says "one open follow-up" but the register has a different count |
| C11 | warn | A `PR #`/`commit` reference cannot be resolved (only with `--resolve-remote`) |
| C12 | warn | Duplicate requirement IDs or matrix rows |
| C13 | warn | A table row has more/fewer columns than its header |

### CLI contract

```bash
node planning/check-claims.js            # fail hard, warn heuristics
node planning/check-claims.js --strict   # warnings fail
node planning/check-claims.js --json     # machine-readable output
node planning/check-claims.js --resolve-remote  # optional PR/commit checks
```

Exit codes: `0` clean or warnings-only; `1` hard failures; `2` usage/IO error.
Output: `file:line: C4 fail: 01 requirement FR13 has no matrix row`.

### Integration

- Run `check-planning.js` then `check-claims.js` in CI and the planning PR
  checklist.
- Start in warn-only mode on the migrated suites; promote rules to fail once
  the existing 20 suites are clean.
- Do not run on `DONE/` or `archived/`.

## Risks and edge cases

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| False confidence | green check ≠ true design | document the limitation; reviewer/human still gate |
| Prose claims not in the evidence table | can still drift | reviewer checklist; evidence table is the contract |
| Index parsing is brittle | false failures | stable table format; regex fixtures |
| Local paths may be future/create | false failures | `pending:`/`create:` allowlist |
| Remote PR/commit checks need auth | flaky CI | optional flag, never default |
| Legacy suites | historical noise | skip suites without frontmatter |
| Over-strict warnings | alert fatigue | default warn-only for heuristics |

## Alternatives considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A · Extend `check-planning.js` | one command | couples structural and claim rules | rejected; keep two CLIs, shared lib |
| B · LLM claim checker | understands prose | noisy, expensive, non-deterministic | rejected for this ticket |
| C · Human-only claim review | best judgment | exactly the drift we keep hitting | keep for prose/semantics |
| D · Structured evidence + deterministic script | cheap, repeatable | only checks what is written | chosen |

## Rollout

1. Add the evidence table to the templates (done in this review-pipeline PR).
2. Implement C1-C8 in warn-only mode against the migrated suites.
3. Fix the migrated suites until the warnings are clean.
4. Promote C1-C8 to fail; keep C9-C13 as warnings.
5. Add to CI/pre-commit; add `--strict` for release branches.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register.
