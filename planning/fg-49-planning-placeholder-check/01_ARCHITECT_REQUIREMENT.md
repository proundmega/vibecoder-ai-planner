# 01 — Requirement (fg-49)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), deferred table (`00`).

## Problem

The planning templates use `{{...}}` placeholders. A new suite can be committed
with `{{DATE}}`, `{{Title}}`, `{{FR1}}` or similar because `check-planning.js`
only looks for a few known placeholder strings in completed `03` Results. The
result is a suite that looks structurally valid but has missing facts.

## Goals

1. Make unresolved placeholders in active planning suites fail the planning
   check.
2. Report the suite, file, line and placeholder text so the author can fix it.
3. Keep historical and template directories exempt.
4. Keep the check deterministic and free of network/LLM calls.

## Non-goals

- Do not implement the broader claim/evidence checker (`fg-48`).
- Do not rewrite historical `DONE/` or `archived/` suites.
- Do not reject deliberate brace text in prose or code examples; only reject
  template placeholders in active suite documents.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | `check-planning.js` scans active suite markdown files for unresolved `{{...}}` placeholders. | A planned suite containing `{{DATE}}` exits non-zero. |
| FR2 | The failure output names the suite path, file, line and placeholder. | Output contains the file path, a line number and the literal placeholder token. |
| FR3 | `DONE/`, `archived/` and `planning/lightweight/` are exempt from the scan. | Fixtures in those directories do not fail the check; active fixtures do. |
| FR4 | The scan covers `00`–`05` documents, including optional `04` and `05`. | A placeholder in a `04` or `05` file fails the check. |
| NFR1 | The check is deterministic and has no network or model dependency. | Running it twice produces the same report; no external process is started. |

## Acceptance

The expected output for a failing active suite is:

```text
Planning check failed (1):
  - fg-XX-example/00_ARCHITECT_CHECKLIST.md:12: unresolved placeholder {{DATE}}
```

The exact wording may vary, but the suite/file/line/placeholder must be present.
