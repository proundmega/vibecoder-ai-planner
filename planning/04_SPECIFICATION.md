# 04_SPECIFICATION.md — Model Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: {{7B | 14B | 34B local model}}
**Date**: {{YYYY-MM-DD}}

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### CREATE: `{{file path}}`

**Imports** (exact):
```
import { ... } from '...'
import { ... } from '...'
```

**State variables** (exact names and types):
```
varName: type → purpose / binding
varName: type → purpose / binding
```

**Functions** (exact signatures):
```
async function functionName(param: Type): Promise<ReturnType>
  1. Step 1
  2. Step 2
  3. try: ... catch: ... finally: ...
```

**Template structure** (exact hierarchy, if UI):
```
<parent>
  <child attribute="value">
    content
  </child>
</parent>
```

**Styling**: {{scoped CSS / Tailwind classes / inline styles — be specific}}

### MODIFY: `{{file path}}`

**Add method/function**:
```
async function name(params): ReturnType
  Logic:
    1. Step
    2. Step
```

**Position in file**: {{add after which existing method, or at which line number}}

**Imports to add**:
```
import { ... } from '...'
```

### DELETE: `{{file path}}`

**What to remove**: {{specific lines, function, or file}}

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — {{Component or Module Name}}
```
✓ [happy] createFoo with valid input returns foo object
✓ [error] createFoo with duplicate name returns 400
✓ [error] createFoo without required field returns ValidationError
✓ [edge] setAssignee(null) clears assignee (dynamic SET, not COALESCE)
```

**Minimum**: 1 happy + 1 error per new controller/service method, 1 per new validator.

### Backend Bash Integration Tests
```
✓ [happy] POST /api/v1/foo returns 201 with foo object
✓ [auth] POST /api/v1/foo without token returns 401
✓ [perm] user role POST /api/v1/foo returns 403
✓ [flow] create → GET /api/v1/foo/:id → DELETE → GET /api/v1/foo/:id returns 404
```

**Minimum**: happy path, auth failure, permission denial, multi-step lifecycle.

### Frontend Unit Tests — {{Component or Module Name}}
```
✓ [api] createFoo() calls POST /api/v1/foo with correct body
✓ [api] createFoo() returns null when backend returns 400
✓ [ui] FooList renders loading spinner while fetching
✓ [ui] FooList renders "No foos" when list is empty
✓ [ui] FooList renders error message on fetch failure
```

**Minimum**: 1 per API client function + loading/empty/error states per UI component.

### Frontend Contract Tests
```
✓ [shape] Foo response contains id, name, createdAt (no snake_case fields)
✓ [enum] Foo status accepts expected values (active|inactive|archived)
✓ [error] Error response uses { error: { code, message } } format
```

---

## Edge Cases to Handle

1. **[Edge case]**: Expected behavior
2. **[Edge case]**: Expected behavior
3. **[Edge case]**: Expected behavior

---

## Existing Code Patterns to Follow

- {{Pattern 1 — e.g., "Use `<script setup>` syntax, not Options API"}}
- {{Pattern 2 — e.g., "Import from `@/stores/` not relative paths"}}
- {{Pattern 3 — e.g., "Error messages in English, no i18n wrappers"}}

---

## Files NOT to Change

- {{file path}} — unrelated to this ticket
- {{file path}} — already works correctly

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
