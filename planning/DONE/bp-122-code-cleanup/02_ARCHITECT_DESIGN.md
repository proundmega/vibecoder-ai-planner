# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Agent
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

PR #97 introduced three code quality issues that should be cleaned up:
1. Dead `createPullRequestRetry()` method in agent GitHubService
2. Verbose 8-parameter `Ticket.update()` signature
3. Unpinned git version in Agent Dockerfile

---

## Current State

### Issue 1: Dead Code
`GitHubService.java` contains `createPullRequestRetry()` which was only called by `deleteExistingPR()`. After removing `deleteExistingPR()` in PR #97, this method is unreachable.

### Issue 2: Ticket.update() Signature
```javascript
// Current (8 positional params)
static async update(id, title, description, status, priority, assigneeId, _userId, prUrl)

// Called as:
Ticket.update(id, data.title, data.description, data.status, data.priority, data.assigneeId, userId, prUrl)
```

### Issue 3: Dockerfile
```dockerfile
# Current
RUN apk add --no-cache git
```

---

## Design

### Issue 1: Remove Dead Code

**Action**: Delete `createPullRequestRetry()` method entirely.

**Verification**: `grep -r createPullRequestRetry` should return no results after removal.

**Risk**: None — method is already unreachable.

### Issue 2: Refactor Ticket.update() to Options Object

**Action**: Change signature from 8 positional params to `(id, options)`.

**Current**:
```javascript
static async update(id, title, description, status, priority, assigneeId, _userId, prUrl) {
  const sets = [];
  const vals = [];
  let idx = 1;
  if (title !== undefined) { sets.push(`title = $${idx}`); vals.push(title); idx++; }
  // ... 6 more params
}
```

**New**:
```javascript
static async update(id, { title, description, status, priority, assigneeId, prUrl }) {
  const sets = [];
  const vals = [];
  let idx = 1;
  if (title !== undefined) { sets.push(`title = $${idx}`); vals.push(title); idx++; }
  // ... same logic
}
```

**Caller update** (`TicketService.update()`):
```javascript
// Before:
return await Ticket.update(id, data.title, data.description, data.status, data.priority, data.assigneeId, userId, prUrl);

// After:
return await Ticket.update(id, { title: data.title, description: data.description, status: data.status, priority: data.priority, assigneeId: data.assigneeId, prUrl });
```

**Tests to update**: `backend/src/__tests__/ticketService.test.js` — verify tests pass with new signature.

**Risk**: Low — only one caller (`TicketService.update()`). Easy to verify with tests.

### Issue 3: Pin Git Version in Dockerfile

**Action**: Replace `apk add --no-cache git` with version-pinned version.

**Approach**: Use `apk add --no-cache git=<version>` to pin the version.

**Example**:
```dockerfile
# Check available version first:
# docker run --rm alpine:latest apk list --available git 2>/dev/null | grep git

# Then pin:
RUN apk add --no-cache git=2.47.1-r0
```

**Risk**: Low — git version pinning is a best practice. Should verify the pinned version is available in the Alpine image used by the Dockerfile.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` | MODIFY | Remove `createPullRequestRetry()` method |
| `backend/src/models/ticket.js` | MODIFY | Change `update()` signature from 8 params to `(id, options)` |
| `backend/src/services/TicketService.js` | MODIFY | Update `Ticket.update()` call to use options object |
| `backend/src/__tests__/ticketService.test.js` | MODIFY | Update test mocks for new signature |
| `agent/Dockerfile` | MODIFY | Pin git version |

---

## Dependencies

### Cross-Cutting Dependencies
- None — all 3 items are independent

### Testing Dependencies
- Backend: `npm test` must pass after refactoring
- Agent: `mvn package -DskipTests -B` must succeed after removing dead code
- Docker: Dockerfile must build successfully with pinned git

---

## Config / Environment Changes

- No new environment variables
- No new database migrations
- No new npm dependencies

---

## Database Changes

No database changes needed.

---

## Security Considerations

- Removing dead code has no security impact
- Refactoring method signature has no security impact
- Pinning git version improves reproducibility (security best practice)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/ticketService.test.js` | Refactored Ticket.update() signature |
| Agent compile | Maven | `agent/` | Dead code removal doesn't break build |
| Docker build | Docker | `agent/Dockerfile` | Pinned git version installs correctly |

### Tests to Update
- `backend/src/__tests__/ticketService.test.js` — verify `Ticket.update` mock captures options object correctly

---

## Risks and Edge Cases

### Risks
- **[Risk]**: Refactoring `Ticket.update()` signature could break if there are hidden callers
  - **Mitigation**: `grep -r "Ticket\.update(" backend/` to find all callers — only `TicketService.update()` calls it

- **[Risk]**: Pinned git version may not be available in the Alpine image tag used by the Dockerfile
  - **Mitigation**: Check available versions before committing, use `docker run --rm alpine:<tag> apk list --available git`

### Edge Cases
- **None significant** — these are straightforward cleanups

---

## Alternative Designs Considered

### Alternative for Issue 2: Partial refactor (keep current, add JSDoc)
- **Pros**: Minimal change
- **Cons**: Doesn't solve the readability problem
- **Decision**: Full refactor is better — one-time cost, long-term benefit

### Alternative for Issue 3: Use alpine git package from specific repository
- **Pros**: Could use a more stable git source
- **Cons**: Adds unnecessary complexity
- **Decision**: Version pinning via `apk add git=<version>` is sufficient

---

## Specification Generation

This design is sufficient for implementation. The `04_SPECIFICATION.md` should list exact file paths and changes.

---

*These are small, low-risk cleanups that improve code maintainability.*
