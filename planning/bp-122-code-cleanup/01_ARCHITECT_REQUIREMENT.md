# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-09-15
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Scope**: Backend + Agent
**Priority**: P3
**Effort**: Small

---

## Requirement

PR #97 introduced several code quality issues that are non-blocking but should be cleaned up before or after merge to improve code maintainability.

### Issue 1: Dead code — `createPullRequestRetry` in agent GitHubService

After removing `deleteExistingPR()` (review fix), the `createPullRequestRetry()` method is now unreachable. Its only caller was `deleteExistingPR()`, which called it after deleting an existing PR. Now the 422 error path either returns the existing PR URL or throws an exception. `createPullRequestRetry()` is dead code.

**Location**: `agent/src/main/java/com/vibecode/agent/service/GitHubService.java`

### Issue 2: Verbose `Ticket.update()` signature

`Ticket.update()` now has 8 positional parameters: `(id, title, description, status, priority, assigneeId, _userId, prUrl)`. Adding `prUrl` as the 8th param makes the signature hard to read and error-prone (easy to swap positional arguments). An options-object pattern would be cleaner.

**Location**: `backend/src/models/ticket.js` (line 87)

**Current**:
```javascript
static async update(id, title, description, status, priority, assigneeId, _userId, prUrl)
```

**Preferred**:
```javascript
static async update(id, options)
// options = { title, description, status, priority, assigneeId, prUrl }
```

### Issue 3: Unpinned git version in Agent Dockerfile

The Agent Dockerfile installs git via `RUN apk add --no-cache git` which pulls the latest version from Alpine. This could break if Alpine upstream changes git behavior. Should pin to a specific version.

**Location**: `agent/Dockerfile`

---

## Existing Infrastructure Audit

### Issue 1: Dead Code
- [x] `createPullRequestRetry()` exists in `agent/src/main/java/com/vibecode/agent/service/GitHubService.java`
- [x] Only caller was `deleteExistingPR()` — which was removed in PR #97
- [x] No other references to `createPullRequestRetry()` in the codebase

### Issue 2: Ticket.update() Signature
- [x] `Ticket.update()` called from `TicketService.update()` (line 114-123)
- [x] 8 positional parameters — easy to misorder
- [x] No existing tests verify parameter order explicitly

### Issue 3: Dockerfile
- [x] Agent Dockerfile uses `apk add --no-cache git` without version pin
- [x] Alpine git versions are available via `apk show git` or `apk list --available`

---

## Scope

### In Scope
1. Remove `createPullRequestRetry()` method and all references
2. Refactor `Ticket.update()` to use options object pattern
3. Pin git version in Agent Dockerfile

### Out of Scope
- Other Dockerfile improvements (node version pin, etc.)
- Refactoring other methods with many positional parameters
- Adding new dependencies or tools

---

## Pending Scope Items to Present to User

No deferred improvements from previous tickets' "Out of Scope" sections are relevant to this cleanup. These are internal code quality improvements.
