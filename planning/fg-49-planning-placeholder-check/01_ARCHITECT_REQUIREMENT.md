# 01 — Requirement (fg-49)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), deferred table (`00`).

## Problem

The planning templates use `{{...}}` placeholders. A suite can be committed
with `{{DATE}}`, `{{Title}}`, `{{FR1}}` or similar because `check-planning.js`
only looks for a few known placeholder strings in completed `03` Results. The
result is a suite that looks structurally valid but has missing facts.

## Goals

1. Make unresolved placeholders in **active, migrated** planning suites fail
   the planning check.
2. Report the suite, file, line and placeholder text so the author can fix it.
3. Keep historical, template and not-yet-started directories exempt.
4. Keep the check deterministic and free of network/LLM calls.
5. Make the repository that commits the check pass it.

## Non-goals

- Do not implement the broader claim/evidence checker (`fg-48`).
- Do not rewrite historical `DONE/` or `archived/` suites.
- Do not reject deliberate brace text in fenced code blocks or non-active
  planning documents; only reject template placeholders in active suite
  documents.
- Do not scan suites that have not started (`planned`, `deferred`, `cancelled`)
  or legacy directories without YAML frontmatter.

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence | State |
|---|---|---|---|---|
| A1 | The status in `00` frontmatter is the authoritative "started" signal. | A started suite could be skipped, or a planned suite could fail before it is filled in. | Checker test for each status; reviewer spot-check. | open |
| A2 | Fenced code blocks are examples, not unresolved facts. | Real placeholders inside fences would be missed. | Require authors to move real placeholders outside fences; test both cases. | open |
| A3 | Active legacy suites can be reported separately and migrated in `fg-50` instead of scanned in place. | Retired wording/placeholders in legacy suites remain unchecked until migration. | `fg-50` staged migration; checker reports the legacy count. | open |

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | `check-planning.js` scans **migrated active suites** (YAML frontmatter in `00`) whose status is `in_progress`, `in_review` or `done` for unresolved `{{...}}` placeholders. `planned`, `deferred` and `cancelled` suites are exempt. | An `in_progress` suite containing `{{DATE}}` exits non-zero; a `planned` fixture containing `{{DATE}}` passes. |
| FR2 | The failure output names the suite path, file, line and placeholder. | Output contains the file path, a line number and the literal placeholder token. |
| FR3 | `DONE/`, `archived/` and `planning/lightweight/` are exempt; suites without YAML frontmatter are reported as legacy and are not scanned for placeholders. | Fixtures in those directories do not fail; an active legacy suite is counted separately and passes the placeholder scan. |
| FR4 | The scan covers `00`–`05` documents, including optional `04` and `05`, but ignores fenced code blocks, inline code spans and the `## Results` table. | A placeholder in normal prose in a `04` or `05` file fails; a placeholder inside a fenced block, inline code or the Results table does not. |
| FR5 | The repository self-check passes: after the change, `node planning/check-planning.js` exits zero on the tree that contains the check, including planned suites with intentional template text and fenced examples. | A test runs the checker against the repository root (or a fixture copy) and asserts exit 0. |
| NFR1 | The check is deterministic and has no network or model dependency. | Running it twice produces the same report; no external process is started. |

## Acceptance

The expected output for a failing active suite is:

```text
Planning check failed (1):
  - fg-XX-example/00_ARCHITECT_CHECKLIST.md:12: unresolved placeholder {{DATE}}
```

The exact wording may vary, but the suite/file/line/placeholder must be present.
A planned suite, a fenced example and the Results table are not failures.

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| API routes/contracts | none | checker only |
| Database/migrations | none | no schema change |
| Frontend | none | no product UI |
| Agent/harness | none | no runtime path |
| Permissions/auth | none | no permission change |
| Background jobs/external calls | none | offline check |
| Downstream tickets | `fg-50` reuses the scoped checker for retired wording; `fg-51` consumes requirement IDs, not placeholders | `fg-50`, `fg-51` |
| Rollback | revert the checker change; no data migration | git revert |
