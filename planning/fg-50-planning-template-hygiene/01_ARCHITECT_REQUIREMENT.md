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
3. Reject retired wording and legacy formats in active templates/suites.
4. Generate or strictly validate the status indexes.
5. Define `04` as an execution-time artifact with clear post-merge ownership.

## Non-goals

- Do not rewrite historical requirements, designs or results.
- Do not change runtime behavior, APIs or agent execution.
- Do not migrate every historical legacy suite in one pass; the cleanup is
  staged and reviewable.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Completed suites are moved to `planning/DONE/`; `check-planning.js` fails an active suite with `status: done`. | The checker exits non-zero for a fixture done suite outside `DONE/`; the real tree has no active done suites. |
| FR2 | Repository and product templates (`00`–`04`) share one source or a drift test compares required headings/wording, including the `01` risk sections (assumptions, change impact) and `02` risk sections (failure modes, security considerations). | Changing only one template makes the template test fail. |
| FR3 | Active templates and suites reject retired wording (`IPEE`, `small model`, `7B`, `14B`, `34B`, `Target model`). | A fixture with `small model` fails; `DONE/` and `archived/` are exempt. |
| FR4 | Pending suites use the current YAML `00` frontmatter; legacy-format pending suites are reported. | A planned suite with `**Status**:` fails; a legacy suite in `DONE/` passes. |
| FR5 | `PENDING.txt` and `HARNESS_ROADMAP.md` rows are generated from `00` frontmatter or strictly checked against it. | A mismatched label fails; a suite with no index row is reported. |
| FR6 | `04_SPECIFICATION.md` is documented as execution-time only and is not required to track post-merge implementation changes. | The templates and `planning/README.md` say the code/tests are authoritative after execution. |
| NFR1 | The checks are deterministic, network-free, and do not change production behavior. | Repeated checker runs produce the same result; no runtime/API/agent code changes are required. |

## Acceptance

The expected outcome is a clean checker run over the active tree after the
one-time cleanup, plus failing fixtures for each new rule. Historical
`DONE/`/`archived/` content is preserved as-is.
