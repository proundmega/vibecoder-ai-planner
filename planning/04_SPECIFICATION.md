# 04_SPECIFICATION.md — Model Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: {{7B | 14B | 34B local model}}
**Date**: {{YYYY-MM-DD}}

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

### {{Component or Module Name}}
```
✓ Test 1 — specific scenario
✓ Test 2 — specific scenario
✓ Test 3 — error case
✓ Test 4 — edge case
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
