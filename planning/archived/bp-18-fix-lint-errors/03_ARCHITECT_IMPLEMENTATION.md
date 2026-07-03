# 03_ARCHITECT_IMPLEMENTATION.md — Fix Frontend Lint Errors

**Status**: completed
**Priority**: P1 (High)
**Effort**: Trivial (~5 minutes)
**Author**: AI Assistant
**Date created**: 2026-06-22
**Date completed**: 2026-06-22
**PR**: TBD
**Branch**: bp-18-fix-lint-errors

## Implementation Plan

### Phase 1: Fix `validator.ts`
1. Remove line 1: `import type { User, Project, Ticket, Agent, ApiResponse } from '../api/generated';`

### Phase 2: Fix `ProjectDetail.vue`
1. Remove lines 205-221: `handleCreatePR` function

### Phase 3: Verify
1. `cd frontend && npm run lint`
2. `cd frontend && npm run typecheck`
3. `cd frontend && npm test -- --run`
4. `cd frontend && npm run build`

## Rollback Plan

Revert the two file changes if tests fail.

---

*Ready for implementation.*
