# 02_ARCHITECT_DESIGN.md — Fix Frontend Lint Errors

**Status**: completed
**Date created**: 2026-06-22
**Date completed**: 2026-06-22

## Problem

Two lint/typecheck errors prevent a clean frontend build:

1. `validator.ts` imports 5 unused types
2. `ProjectDetail.vue` has an unused function

## Current State

### `frontend/src/api/validator.ts:1`
```typescript
import type { User, Project, Ticket, Agent, ApiResponse } from '../api/generated';
```
These types are never referenced in the file. The validator uses its own hand-written `SchemaDefinition` interface.

### `frontend/src/views/ProjectDetail.vue:205-221`
```typescript
async function handleCreatePR() {
  if (!prBranchName.value.trim() || !prTitle.value.trim()) return
  creatingPR.value = true
  githubError.value = null
  try {
    await createPR(route.params.ticketId || '0', prTitle.value.trim(), prBody.value.trim(), prBranchName.value.trim())
    githubSuccess.value = 'Pull request created successfully'
    await loadPRs()
    prBranchName.value = ''
    prTitle.value = ''
    prBody.value = ''
  } catch (err) {
    githubError.value = err.message || 'Failed to create PR'
  } finally {
    creatingPR.value = false
  }
}
```
Never called from template or script. No "Create PR" button exists in the GitHub tab.

## Design

### Fix 1: `validator.ts` — Remove unused import

Delete line 1 entirely. No other code depends on these types.

**Before:**
```typescript
import type { User, Project, Ticket, Agent, ApiResponse } from '../api/generated';

interface SchemaDefinition { ... }
```

**After:**
```typescript
interface SchemaDefinition { ... }
```

### Fix 2: `ProjectDetail.vue` — Remove unused function

Delete lines 205-221 (`handleCreatePR` function).

**Verification**: Searched template — no `@click="handleCreatePR"`, no method references. Confirmed unused.

## Data Flow

No data flow changes. Both are dead code removal.

## Risk Assessment

- **Risk**: None — removing unused code
- **Rollback**: Revert the two file changes

---

*Ready for implementation phase.*
