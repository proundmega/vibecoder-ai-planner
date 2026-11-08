# 03 — Implementation ({{id}})

> Lightweight suite: use with the lightweight `00`; requirements live there.

## Plan

1. **{{Step name}}** — {{what changes}} — verify: {{command or test}}
2. {{...}}

## Per-file changes

| File | Action | Change |
|---|---|---|
| `{{path}}` | CREATE / MODIFY / DELETE | {{what}} |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | {{layer}} | `{{test file}}` | {{name}} | `{{command}}` |
| NFR1 | {{layer}} | `{{test file}}` | {{name}} | `{{command}}` |

## Verification commands

```bash
node planning/check-planning.js
{{command}}
```

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | {{primary / second}} | {{finding IDs or none}} | {{commit / change}} | {{new SHA / none}} |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| {{YYYY-MM-DD}} | {{sha}} | {{suite result}} | {{pass/fail}} |
