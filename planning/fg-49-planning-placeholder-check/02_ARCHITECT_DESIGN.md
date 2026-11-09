# 02 — Design (fg-49)

> **Owns:** current-state audit, chosen design, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), status (`00`).

## Current state

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Planning checker | yes | `planning/check-planning.js` | No general placeholder scan |
| Planning tests | partial | `planning/check-planning.test.js` | Repository self-check exists; rule fixtures still needed |
| Frontmatter status gate | yes | `frontmatter()` in `planning/check-planning.js` | Status is read but not used to scope scans |
| Template exemptions | yes | `SKIP = new Set(['DONE', 'archived', 'lightweight'])` | `lightweight` is already added in this PR; verify with a test |

`check-planning.js` already reads each suite's `00` and skips directories in
`SKIP` and suites without YAML frontmatter. The new check reuses that walk and
status gate; no dependency or parser is needed.

## Design summary

1. **Scope:** scan a suite only when its `00` frontmatter exists and its
   `status` is `in_progress`, `in_review` or `done`. `planned`, `deferred` and
   `cancelled` suites are exempt because they may still carry template text
   until work starts.
2. **Files:** read every `\d\d_*.md` file in the suite, so optional `04` and
   `05` are covered.
3. **Escapes:** remove fenced code blocks and inline code spans before matching,
   and skip the `## Results` table. The existing `done` Results check remains the
   owner of Results placeholders. This lets an active suite document
   `{{DATE}}`/`{{...}}` in backticks or a fence without failing.
4. **Match:** use `/\{\{[^{}\n]+\}\}/g` on the remaining prose.
5. **Report:** record `suite/file:line:placeholder` and add a failure through
   the existing `failures` list and exit code.
6. **Legacy:** suites without frontmatter are reported as a separate legacy
   count and are not scanned until `fg-50` migrates them.
7. **Self-check:** extend the pre-seeded `planning/check-planning.test.js`
   repository self-check so it asserts exit 0, including the planned suites
   that introduce the rule.

## Risks and edge cases

- **Planned suites:** exempt by design; the check starts enforcing when the
  suite moves to `in_progress`. This is why fg-49/fg-50/fg-51 can be merged
  while they still contain `{{...}}` examples and placeholder Results rows.
- **Fenced/inline examples:** ignored, so requirement tables can show
  placeholder syntax without failing. Real placeholders must be outside a
  fence and outside inline code.
- **Results table:** ignored by this scan; `status: done` still requires a
  dated, non-placeholder Results row under the existing rule.
- **Legacy suites:** active legacy suites such as `bp-98` are reported, not
  scanned. `fg-50` owns the staged migration; this ticket does not rewrite
  historical content.
- **Root templates:** `planning/0*.md` are not suites and are not scanned by
  this check; template placeholders are intentional.
- The scan must not crash on missing files or non-markdown files.

## Rollout

Ship as a checker-only change behind the existing command:
`node planning/check-planning.js`. No runtime, API or agent code changes.
