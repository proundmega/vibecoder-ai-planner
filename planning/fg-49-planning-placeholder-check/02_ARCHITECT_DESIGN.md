# 02 — Design (fg-49)

> **Owns:** current-state audit, chosen design, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), status (`00`).

## Current state

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Planning checker | yes | `planning/check-planning.js` | No general placeholder scan |
| Planning tests | no | — | No regression coverage for checker behaviour |
| Template exemptions | partial | `SKIP = new Set(['DONE', 'archived'])` | Needs the lightweight template directory too |

`check-planning.js` already reads each active suite's `00` and `03` and skips
directories in `SKIP`. The new check can use the same directory walk and file
reads; no dependency or parser is needed.

## Design summary

1. Extend the active-suite scan to read every `\d\d_*.md` file in the suite.
2. Match `{{...}}` with a small regular expression, for example
   `/\{\{[^{}\n]+\}\}/g`.
3. For each match, record `suite/file:line:placeholder` and add a failure.
4. Add `lightweight` to `SKIP` so template files with intentional placeholders
   are not treated as a suite.
5. Keep the existing failures list and exit code; do not add a second reporting
   channel.

## Risks and edge cases

- A prose paragraph may legitimately show a placeholder example. Prefer
  failing closed for active suites and document the escape hatch: put literal
  examples in `DONE/`, `archived/` or `planning/lightweight/`.
- The scan must not crash on directories without `00` or on non-markdown files.
- Do not scan `.git`, `node_modules`, `target` or the lightweight templates.
- The existing `done` Results placeholder check remains; this check is broader
  and runs for planned/in-progress suites too.

## Rollout

Ship as a checker-only change behind the existing command:
`node planning/check-planning.js`. No runtime, API or agent code changes.
