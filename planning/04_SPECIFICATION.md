# 04 — Execution Spec ({{id}})

Optional. Use when a smaller model will execute the ticket. This file makes
file operations exact; it does **not** restate `01`, `02`, or `03`.

**Generated from:** `01_ARCHITECT_REQUIREMENT.md`,
`02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model:** {{7B | 14B | 34B}}
**Requirement IDs covered:** {{FR1, FR2, NFR1}}

## Test-first requirement

Create the empty test stubs listed under *Test expectations* **before** any
production code. Then implement. Then fill in the assertions.

## File operations

The model must not create, modify, or delete a file that is not listed here.

### CREATE `{{path}}`

**Imports (exact):**

```js
{{...}}
```

**State (exact names and types):**

```
{{varName: type → purpose}}
```

**Functions (exact signatures):**

```
{{async function name(params): ReturnType}}
  1. {{step}}
  2. {{step}}
```

**Template structure (UI only):**

```html
{{...}}
```

### MODIFY `{{path}}`

- Position: {{after method X / at line N}}
- Add: {{exact change}}
- Imports to add: {{...}}

### DELETE `{{path}}`

- Remove: {{...}}

## Test expectations

Each case is tagged with the requirement it proves. Minimum: one happy and one
error path per new public function; loading, empty and error states per new UI
component.

```
✓ [FR1][happy] {{input}} → {{expected}}
✓ [FR1][error] {{input}} → {{expected}}
✓ [NFR1][edge] {{condition}} → {{behaviour}}
```

## Edge cases

| Case | Expected behaviour |
|---|---|
| {{...}} | {{...}} |

## Review notes

- Every `FR*`/`NFR*` from `01` must appear in the test expectations above; a
  missing requirement is a spec bug, not a coding decision.
- The model must not create, modify or delete a file outside the listed
  operations. The reviewer checks the diff against this list.
- Record reviewer evidence and blocking-finding resolution in `03`; this file
  contains instructions, not results.

## Patterns to follow

- {{`backend/src/services/FooService.js` — controller/service split}}
- {{`frontend/src/api/tickets.js` — client style}}
- Repo-wide rules: `planning/ENGINEERING_STANDARDS.md`

## Files NOT to change

- `{{path}}` — {{why}}
