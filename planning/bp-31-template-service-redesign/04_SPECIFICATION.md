# bp-31: TemplateService Redesign — Spec

**Target model**: 14B–70B (text generation, no code gen needed)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/src/services/TemplateService.js`

**Imports**: No new imports needed. Existing imports remain:
```javascript
const { pool } = require('../db');
```

**Changes**:

1. **`ARCHITECT_TEMPLATE_FILES`** — add 5th entry:
```javascript
const ARCHITECT_TEMPLATE_FILES = [
  { key: '00_ARCHITECT_CHECKLIST.md', title: 'Pre-Implementation Checklist', required: true },
  { key: '01_ARCHITECT_REQUIREMENT.md', title: 'Requirement', required: true },
  { key: '02_ARCHITECT_DESIGN.md', title: 'Design', required: true },
  { key: '03_ARCHITECT_IMPLEMENTATION.md', title: 'Implementation', required: true },
  { key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true },
];
```

2. **New constant** (after `SIMPLE_TEMPLATE_FILES`):
```javascript
const SPECIFICATION_TEMPLATE_FILES = [
  { key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true },
];
```

3. **`getArchitectTemplateContent`** — rewrite the templates map keys entirely.

**Signature** (unchanged):
```javascript
static getArchitectTemplateContent(fileKey) { /* returns string */ }
```

**Template for `00_ARCHITECT_CHECKLIST.md`**:
```
# 00_ARCHITECT_CHECKLIST.md

**Status**: planned
**Date created**: {date}
**Author**: TBD

---

## Pre-Implementation Checklist

### Planning
- [ ] Ticket description is clear and unambiguous
- [ ] Acceptance criteria are testable
- [ ] Edge cases are documented
- [ ] Success metrics are defined

### Existing Infrastructure Audit
- [ ] Checked if backend API already exists for this feature
- [ ] Checked if frontend components already exist
- [ ] Checked if DB migration is required vs. can use existing schema
- [ ] Checked if existing tests cover related functionality

### Dependency Analysis
- [ ] All upstream dependencies are completed (not in-flight)
- [ ] No circular dependencies introduced
- [ ] Dependent teams/services have been notified

### Config Audit
- [ ] Environment variables required? Documented in .env.example?
- [ ] Feature flags needed?
- [ ] Rate limits / timeouts configured?

### Testing Strategy
- [ ] Unit tests identified
- [ ] Integration tests identified
- [ ] E2E tests identified
- [ ] Manual test scenarios documented

### Rollback Readiness
- [ ] Rollback plan documented
- [ ] Data migration is reversible (if applicable)
- [ ] Feature flag can disable the change

---

## When to Ask the User

- If the scope has changed since the requirement was written
- If an alternative approach would take significantly less effort
- If there are multiple valid approaches with different tradeoffs
- If the change affects existing user-facing behavior or data
- If you discover a dependency that is not yet implemented

---

*Complete this checklist before starting implementation.*
```

**Template for `01_ARCHITECT_REQUIREMENT.md`**:
```
# 01_ARCHITECT_REQUIREMENT.md

**Status**: planned
**Date created**: {date}
**Author**: TBD

---

## Problem Statement

Describe the problem this ticket solves. What is broken, missing, or suboptimal? Who is affected?

---

## Scope

### In Scope
- What is included
- What is included

### Out of Scope
- What is NOT included
- What is NOT included

---

## Acceptance Criteria

- [ ] Criterion 1 — specific, testable, observable
- [ ] Criterion 2 — specific, testable, observable
- [ ] Criterion 3 — specific, testable, observable

---

## Known Unknowns

- **Item 1**: What we don't know about this
- **Item 2**: What we don't know about this

---

## Decisions Required

1. **Decision question?**
   - Option A: Description with pros/cons
   - Option B: Description with pros/cons
   - **Decision**: TBD (select before implementation)

2. **Decision question?**
   - Option A: Description
   - Option B: Description
   - **Decision**: TBD

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `path/to/file.js` | MODIFY / CREATE / DELETE | Specific changes needed |
| `path/to/file.js` | MODIFY / CREATE / DELETE | Specific changes needed |
| DB | YES / NO | Migration details if yes |
| API | YES / NO | New/changed endpoints |

---

## Dependencies

- **Depends on**: bp-XX (description)
- **Depends on this**: bp-XX (description)

---

*Ready for design phase.*
```

**Template for `02_ARCHITECT_DESIGN.md`**:
```
# 02_ARCHITECT_DESIGN.md

**Status**: planned
**Date created**: {date}
**Scope**: Backend/Frontend/Agent

---

## Current State

Describe how the system currently works. What is the existing flow? Include relevant code paths, data structures, and API endpoints.

---

## Proposed Solution

### Approach

Describe the high-level approach. What changes are being made and why.

### Data Flow

```
Step 1 → Step 2 → Step 3 → Result
```

Describe the data flow with arrows showing direction.

### File-Level Impact

| File | Action | Specific Changes |
|------|--------|-----------------|
| `path/to/file.js` | MODIFY | What changes in this file |

### Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| Scenario 1 | Description of handling |

---

## Security Considerations

- Authentication requirements
- Authorization checks
- Data validation / sanitization
- Rate limiting considerations

---

## DB Changes

### New Tables
- `table_name`: column definitions

### Modified Tables
- `table_name`: added/removed/changed columns

### Migration
- Migration file: `XXX_description.sql`

---

## API Contract

### New Endpoints

```
METHOD /api/v1/path
  Request: { body shape }
  Response 200: { success: true, data: { ... } }
  Response 4xx: { success: false, error: { code, message } }
```

### Changed Endpoints

```
METHOD /api/v1/path
  Changes: description
```

---

*Ready for implementation phase.*
```

**Template for `03_ARCHITECT_IMPLEMENTATION.md`**:
```
# 03_ARCHITECT_IMPLEMENTATION.md

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Backend/Frontend/Agent

---

## Purpose

Describe the purpose and value delivered by this implementation.

---

## Implementation Order

1. **Step name** — `path/to/file.js`
   - Action: CREATE/MODIFY/DELETE
   - Key changes with details
   - *Depends on*: Step number or "nothing"

2. **Step name** — `path/to/file.js`
   - Action: CREATE/MODIFY/DELETE
   - Key changes with details
   - *Depends on*: Step number or "nothing"

---

## Per-File Action Plan

### `path/to/file.js` (CREATE/MODIFY/DELETE)

- Specific code-level changes
- Method signatures to add/change
- Imports to add

### `path/to/file.js` (CREATE/MODIFY/DELETE)

- Specific code-level changes

---

## Migration Plan

Detail any database or data migration steps. If none, write "No migration needed."

---

## Test Plan

### Unit Tests
- [ ] Test case 1
- [ ] Test case 2

### Integration Tests
- [ ] Test case 1
- [ ] Test case 2

### Manual Verification
- [ ] Verification step 1
- [ ] Verification step 2

---

## Rollback Steps

1. `git revert <commit>`
2. Additional steps if needed (e.g., run down migration, rebuild)
3. Verification that system returns to previous state
```

**Template for `04_SPECIFICATION.md`** (standalone or Architect):
```
# 04_SPECIFICATION.md — Execution Specification

**Target model**: {model size recommendation}
**Date**: {date}

---

## File Operations

### CREATE: `path/to/new/file.js`

**Imports**:
```javascript
import { X } from 'y';
```

**Exact function signatures**:
```javascript
export function doSomething(param1: string, param2: number): Promise<Result>
```

**Template**:
- Implementation details for each function
- Key logic branches
- Error handling

### MODIFY: `path/to/existing/file.js`

**Change location**: After line X, before function Y

**Specific changes**:
- Add import
- Add method
- Modify method body

### DELETE: `path/to/file.js`

- Remove entire file
- Remove references in imports/index

---

## Test Expectations

### Unit Tests
- [ ] Test name — what it verifies
- [ ] Test name — what it verifies

### Integration Tests
- [ ] Test name — what it verifies

### Manual Verification
- [ ] Step 1
- [ ] Step 2

---

## Edge Cases to Handle

1. **Empty state**: What happens with no data
2. **Error state**: What happens when API fails
3. **Boundary**: Max/min values
4. **Concurrent**: Multiple simultaneous operations
5. **Partial data**: Incomplete or malformed input

---

## Existing Code Patterns to Follow

- Pattern 1 with example
- Pattern 2 with example
- Import style
- Error handling convention

---

## Files NOT to Change

- `path/to/file.js` — reason
- `path/to/file.js` — reason

---

*Execution specification.*
```

4. **New methods** added to class:
```javascript
static getSpecificationTemplate() {
  return SPECIFICATION_TEMPLATE_FILES;
}

static getSpecificationTemplateContent(fileKey) {
  const templates = {
    '04_SPECIFICATION.md': `# 04_SPECIFICATION.md — Execution Specification\n\n...`,
  };
  return templates[fileKey] || '';
}
```

### MODIFY: `backend/src/__tests__/TemplateService.test.js`

**Change location**: After existing tests in the TemplateService describe block.

**Test additions**:
```javascript
describe('Architect template count', () => {
  it('should return 5 template files', () => {
    const files = TemplateService.getArchitectTemplate();
    expect(files).toHaveLength(5);
    expect(files.map(f => f.key)).toContain('04_SPECIFICATION.md');
  });
});

describe('Specification template type', () => {
  it('should return singlular template', () => {
    expect(TemplateService.getSpecificationTemplate()).toHaveLength(1);
  });
  it('should return content for 04_SPECIFICATION.md', () => {
    const content = TemplateService.getSpecificationTemplateContent('04_SPECIFICATION.md');
    expect(content).toContain('File Operations');
    expect(content).toContain('Test Expectations');
    expect(content).toContain('Edge Cases');
  });
});
```

## Test Expectations

### Unit Tests
- [ ] `getArchitectTemplate()` — returns 5 entries, 5th is `04_SPECIFICATION.md`
- [ ] `getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md')` — contains `Pre-Implementation Checklist` and `When to Ask the User`
- [ ] `getArchitectTemplateContent('01_ARCHITECT_REQUIREMENT.md')` — contains `Problem Statement`, `Scope`, `Acceptance Criteria`, `Known Unknowns`, `Decisions Required`, `Impact Analysis`, `Dependencies`
- [ ] `getArchitectTemplateContent('02_ARCHITECT_DESIGN.md')` — contains `Current State`, `Proposed Solution`, `Security Considerations`, `DB Changes`, `API Contract`
- [ ] `getArchitectTemplateContent('03_ARCHITECT_IMPLEMENTATION.md')` — contains `Purpose`, `Implementation Order`, `Per-File Action Plan`, `Migration Plan`, `Test Plan`, `Rollback Steps`
- [ ] `getArchitectTemplateContent('04_SPECIFICATION.md')` — contains `File Operations`, `Test Expectations`, `Edge Cases to Handle`, `Existing Code Patterns`, `Files NOT to Change`
- [ ] `getSpecificationTemplate()` — returns 1 entry
- [ ] `getSpecificationTemplateContent('04_SPECIFICATION.md')` — returns same content as Architect version
- [ ] Unknown key — returns `''`
- [ ] Backward compatible — `getArchitectTemplate()` results still iterable

## Edge Cases to Handle

1. **Unknown fileKey passed to any content method** — return empty string (existing behavior, test to verify)
2. **Null/undefined fileKey** — return empty string (defensive)
3. **Caller expects exactly 4 template files** — no known callers depend on the array length being 4; all callers iterate the array
4. **Caller calls getSpecificationTemplateContent with wrong key** — returns empty string

## Existing Code Patterns to Follow

- Template strings use backtick literals with `${new Date().toISOString().split('T')[0]}` interpolation
- Content methods use a `templates` object map with string values
- Each template ends with a consistent `*Ready for ...*` footer
- Methods are static and synchronous
- No logging, no error throwing for missing keys

## Files NOT to Change

- `backend/src/api/v1/*` — no API changes
- `backend/src/migrations/*` — no DB migration
- `frontend/src/*` — no frontend changes
- `backend/src/services/TemplateService.js` methods `list`, `create`, `apply`, `delete` — no logic changes
