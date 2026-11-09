# 01 — Requirement (fg-50)

> **Owns:** problem, goals/non-goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), deferred table (`00`).

## Problem

The planning system is healthy enough to produce good tickets, but the
templates and indexes are not self-maintaining:

- `planning/04_SPECIFICATION.md`, `planning/README.md`,
  `backend/src/services/TemplateService.js` and frontend labels describe the
  same document in four places; changing the `04` audience required four edits.
- Completed suites remain in the active root with legacy `**Status**` headers
  and stale execution specs. `check-planning.js` skips suites without YAML
  frontmatter, so those tickets escape validation.
- `PENDING.txt`, `HARNESS_ROADMAP.md` and `00` frontmatter duplicate status
  labels; `check-planning.js` checks only some rows.
- `04_SPECIFICATION.md` is optional but is sometimes treated as a document that
  must stay current after implementation, which creates stale maintenance work.

## Goals

1. Move completed suites out of the active root and enforce the lifecycle.
2. Make product and repository templates share one source or fail a drift test.
3. Reject retired wording and legacy formats in active, migrated
   templates/suites.
4. Generate or strictly validate the status indexes.
5. Define `04` as an execution-time artifact with clear post-merge ownership.
6. Make the repository that commits the checks pass them.

## Non-goals

- Do not rewrite historical requirements, designs or results.
- Do not change runtime behavior, APIs or agent execution.
- Do not migrate every historical legacy suite in one pass; the cleanup is
  staged and reviewable.
- Do not scan not-yet-started (`planned`, `deferred`, `cancelled`) suites for
  retired wording or placeholders; they may retain template text until work
  starts.

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence | State |
|---|---|---|---|---|
| A1 | `00` frontmatter status is the authoritative "started" signal. | A started suite could be skipped, or a planned suite could fail before it is filled in. | Checker tests for each status; reviewer spot-check. | open |
| A2 | A heading/phrase drift test is sufficient until generation is adopted. | Product and repo templates can still diverge in subtle prose. | Required headings and banned/required phrases; `fg-45` risk sections included. | open |
| A3 | Legacy suites can be migrated in staged batches and reported meanwhile. | Active legacy suites remain unscanned until migrated. | `D1` staged migration; checker reports the legacy count. | open |

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Completed suites are moved to `planning/DONE/`; `check-planning.js` fails an active suite with `status: done`. | The checker exits non-zero for a fixture done suite outside `DONE/`; the real tree has no active done suites. |
| FR2 | Repository and product templates (`00`–`04`, including the lightweight `00`) share one source or a drift test compares required headings/wording, including the `01` risk sections (assumptions, change impact) and `02` risk sections (failure modes, security considerations). | Changing only one template makes the template test fail; the lightweight `00` change-impact section is checked. |
| FR3 | Migrated active suites (`in_progress`, `in_review`, `done`) and the root `planning/0*.md` templates reject retired wording (`IPEE`, `small model`, `7B`, `14B`, `34B`, `Target model`). `planned`, `deferred`, `cancelled`, `DONE/`, `archived/`, `lightweight/` and suites without YAML frontmatter are exempt; active legacy suites are reported for migration. Fenced code blocks and inline code spans are ignored so a ticket can quote the retired terms. | An `in_progress` fixture with plain-text `small model` fails; the same term in inline code or a fenced block passes; a `planned` fixture and a `DONE/` fixture pass; a legacy fixture is reported, not scanned. |
| FR4 | Pending suites use the current YAML `00` frontmatter; legacy-format pending suites are reported. | A planned suite with `**Status**:` fails; a legacy suite in `DONE/` passes. |
| FR5 | `PENDING.txt` and `HARNESS_ROADMAP.md` rows are generated from `00` frontmatter or strictly checked against it. | A mismatched label fails; a suite with no index row is reported. |
| FR6 | `04_SPECIFICATION.md` is documented as execution-time only and is not required to track post-merge implementation changes. | The templates and `planning/README.md` say the code/tests are authoritative after execution. |
| FR7 | The repository self-check passes: after the change, `node planning/check-planning.js` exits zero on the tree that contains the checks, including planned suites with intentional template text, fenced examples and the template directories. | A test runs the checker against the repository root (or a fixture copy) and asserts exit 0. |
| NFR1 | The checks are deterministic, network-free, and do not change production behavior. | Repeated checker runs produce the same result; no runtime/API/agent code changes are required. |

## Acceptance

The expected outcome is a clean checker run over the active, migrated tree
after the staged cleanup, plus failing fixtures for each new rule. Planned
suites, fenced examples, legacy suites awaiting migration and historical
`DONE/`/`archived/` content are preserved and do not fail the check.

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| API routes/contracts | none | checker/docs only |
| Database/migrations | none | no schema change |
| Frontend | product template labels only | `frontend/src/views/phases/PhasePlanning.vue`, `TicketDetail.vue` |
| Agent/harness | none | no runtime path |
| Permissions/auth | none | no permission change |
| Background jobs/external calls | none | offline checker |
| Downstream tickets | `fg-49` owns placeholder scanning; `fg-51` consumes requirement IDs | `fg-49`, `fg-51` |
| Rollback | revert the checker/doc change; no data migration | git revert |
