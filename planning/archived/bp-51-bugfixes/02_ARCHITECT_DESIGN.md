# 02_ARCHITECT_DESIGN.md — Bug Fix Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

A comprehensive codebase review found 12 defects across 7 backend files. Defects range from a critical SQL parameter mismatch that causes query failure, to SQL injection risk, to incorrect error types that bypass the error handler, to code quality issues (promise chains, N+1 queries, edge case bugs). All are backend-only, no frontend changes needed.

---

## Current State

### Affected Backend Files

- `backend/src/services/MemoryService.js` — SQL param index $4 should be $3 (line 183), threshold not in SQL (line 187)
- `backend/src/services/TicketService.js` — SQL string interpolation (line 394), undefined field passing (lines 114-119)
- `backend/src/services/ProjectService.js` — generic Error instead of AppError (lines 22-23), Object.values() ordering (line 25)
- `backend/src/services/HeartbeatService.js` — dynamic require in loop (line 72), N+1 subqueries (lines 44-49)
- `backend/src/middleware/auth.js` — promise chains in requireActiveUser (lines 94-101), agentAuth (lines 124-132), verifyTokenOrAgent (lines 168-182)
- `backend/src/controllers/providerController.js` — repeated require('../db') in each function
- `backend/src/utils/crypto.js` — maskToken edge case for 8-char tokens (line 50)

### Existing Patterns

- Error classes: `NotFoundError`, `ForbiddenError`, `ValidationError` from `../errors/HttpError`
- Query style: parameterized queries with `$1`, `$2`, etc.
- Middleware style: `async (req, res, next) => { ... }` with try/catch
- Service style: framework-agnostic, returns data, throws AppError on failure

---

## Design

### Approach: Fix Each Bug in Its Existing File

All 12 bugs are single-file fixes. No new files, no new routes, no database migrations.

#### BP-51-01: MemoryService.searchSimilar SQL param index
**File**: `backend/src/services/MemoryService.js:174-183`
- Change `<=> $4` to `<=> $3` in the SQL query
- Values array is `[projectId, limit, queryEmbedding]` — 3 values, so `$3` is correct

#### BP-51-02: TicketService.recoverOrphanedTickets SQL injection
**File**: `backend/src/services/TicketService.js:394`
- Validate `staleMinutes` is a positive number before using it in SQL interpolation
- If not numeric, throw `ValidationError`

```javascript
if (typeof staleMinutes !== 'number' || staleMinutes <= 0) {
  throw new ValidationError('staleMinutes must be a positive number');
}
```

#### BP-51-03: ProjectService.update generic errors
**File**: `backend/src/services/ProjectService.js:22-23`
- Replace `throw new Error('Project not found')` with `throw new NotFoundError('Project not found')`
- Replace `throw new Error('Unauthorized')` with `throw new ForbiddenError('Unauthorized')`

#### BP-51-04: HeartbeatService cleanupStaleAgents dynamic require
**File**: `backend/src/services/HeartbeatService.js:72`
- Move `const TicketService = require('./TicketService');` to top of file (line 2)
- Remove the inline require from inside the loop

#### BP-51-05: ProjectService.update Object.values() fragility
**File**: `backend/src/services/ProjectService.js:25`
- Replace `...Object.values(data)` with explicit field mapping
- The `Project.update()` call needs specific fields — map them by name

```javascript
const updated = await Project.update(
  id,
  data.name,
  data.description,
  userId
);
```

#### BP-51-06: TicketService.update undefined field passing
**File**: `backend/src/services/TicketService.js:112-120`
- Only pass fields that are defined in `data` to `Ticket.update()`
- Build the args array conditionally, or check each field before passing

```javascript
return await Ticket.update(
  id,
  data.title ?? undefined,
  data.description ?? undefined,
  data.status ?? undefined,
  data.priority ?? undefined,
  data.assigneeId ?? undefined,
  userId
);
```

Note: The controller already filters allowed fields (lines 42-48 of ticketController.js), so the service just needs to not overwrite existing data with undefined.

#### BP-51-07: MemoryService.searchSimilar threshold in SQL
**File**: `backend/src/services/MemoryService.js:174-187`
- Add similarity threshold to SQL using a WHERE clause with a subquery or CTE
- Since `<=>` returns a float and we need `1 - similarity >= threshold`, use:

```sql
WHERE am.embedding IS NOT NULL
  AND (1 - (am.embedding <=> $3)) >= $4
```
- Add `$4` with `threshold` to the values array
- This changes values from `[projectId, limit, queryEmbedding]` to `[projectId, limit, queryEmbedding, threshold]`

#### BP-51-08: auth.js requireActiveUser async/await
**File**: `backend/src/middleware/auth.js:89-101`
- Convert to async function with try/catch

```javascript
exports.requireActiveUser = async (req, res, next) => {
  if (!req.user || !req.user.userId) {
    return res.status(403).json({ error: 'Account deactivated' });
  }
  try {
    const result = await pool.query('SELECT is_active FROM users WHERE id = $1', [req.user.userId]);
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }
    next();
  } catch {
    res.status(403).json({ error: 'Account deactivated' });
  }
};
```

#### BP-51-09: auth.js agentAuth/verifyTokenOrAgent async/await
**File**: `backend/src/middleware/auth.js:104-182`
- Convert both functions to async with try/catch
- Same pattern as BP-51-08

#### BP-51-10: HeartbeatService.getAllAgents N+1 subqueries
**File**: `backend/src/services/HeartbeatService.js:34-56`
- Replace correlated subqueries with LEFT JOIN on agent_actions with date filter
- Use GROUP BY to aggregate actions_per_day

```sql
SELECT
  ah.agent_id,
  a.name,
  ah.status,
  ah.current_ticket_id,
  t.title as current_ticket_title,
  ah.last_seen,
  ah.current_step,
  COALESCE(COUNT(aa.id), 0) as actions_today,
  COALESCE(SUM(aa.cost_incurred), 0) as cost_today
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
LEFT JOIN tickets t ON t.id = ah.current_ticket_id
LEFT JOIN agent_actions aa ON aa.agent_id = ah.agent_id
  AND DATE(aa.created_at) = CURRENT_DATE
GROUP BY ah.agent_id, a.name, ah.status, ah.current_ticket_id,
         t.title, ah.last_seen, ah.current_step
ORDER BY ah.last_seen DESC NULLS LAST
```

#### BP-51-11: providerController.js repeated require
**File**: `backend/src/controllers/providerController.js`
- Move `const { pool } = require('../db');` to top of file (after existing imports)
- Remove inline `require('../db')` calls from each function

#### BP-51-12: crypto.js maskToken edge case
**File**: `backend/src/utils/crypto.js:50`
- Change `token.length < 8` to `token.length <= 8`
- For exactly 8 chars: show last 4, mask first 4 → `****` is correct
- For 7 chars or less: show `****` (no visible chars)
- Actually, the current behavior for 8-char tokens returns `****` (hiding last 4 that should be visible)
- Fix: `token.length < 5` — only mask entirely for tokens shorter than 5 chars

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/MemoryService.js` | MODIFY | BP-51-01: $4→$3, BP-51-07: add threshold filter |
| `backend/src/services/TicketService.js` | MODIFY | BP-51-02: validate staleMinutes, BP-51-06: conditional field passing |
| `backend/src/services/ProjectService.js` | MODIFY | BP-51-03: NotFoundError/ForbiddenError, BP-51-05: explicit field mapping |
| `backend/src/services/HeartbeatService.js` | MODIFY | BP-51-04: move require to top, BP-51-10: JOIN instead of subqueries |
| `backend/src/middleware/auth.js` | MODIFY | BP-51-08: requireActiveUser async/await, BP-51-09: agentAuth/verifyTokenOrAgent async/await |
| `backend/src/controllers/providerController.js` | MODIFY | BP-51-11: move require to top |
| `backend/src/utils/crypto.js` | MODIFY | BP-51-12: fix maskToken threshold |
| `backend/src/__tests__/memoryService.test.js` | EXTEND | Regression tests for BP-51-01, BP-51-07 |
| `backend/src/__tests__/ticketService.test.js` | EXTEND | Regression tests for BP-51-02, BP-51-06 |
| `backend/src/__tests__/projectService.test.js` | EXTEND | Regression tests for BP-51-03, BP-51-05 |
| `backend/src/__tests__/heartbeatService.test.js` | EXTEND | Regression tests for BP-51-04, BP-51-10 |
| `backend/src/__tests__/auth.test.js` | EXTEND | Regression tests for BP-51-08, BP-51-09 |
| `backend/src/__tests__/crypto.test.js` | EXTEND | Regression test for BP-51-12 |

---

## Data Flow Diagram

```
No data flow changes — all fixes are internal corrections.
Existing flow: [Request] → [Route] → [Controller] → [Service] → [DB] → [Response]
```

---

## Dependencies

### Backend Dependencies
- All fixes depend on existing error classes from `../errors/HttpError`
- BP-51-10 depends on `agent_actions` table having proper indexes

### Frontend Dependencies
- None — no frontend changes

---

## Risks and Edge Cases

### Backend Risks
- **BP-51-07**: Adding threshold to SQL WHERE clause may reject results that were previously filtered client-side. This is the intended behavior (more efficient), but changes which results are returned.
- **BP-51-10**: Replacing correlated subqueries with JOIN + GROUP BY may change result ordering or duplicate rows if an agent has multiple actions in a day. Need to verify GROUP BY handles this correctly.

### Edge Cases
- **BP-51-02**: `staleMinutes` could be null, undefined, string, or negative — all should be rejected
- **BP-51-06**: Controller passes `data.title`, `data.description` etc. which may be undefined if not in body — service should not overwrite existing values
- **BP-51-12**: Token lengths 1-4 return `****`, 5-8 return `***xxx` (3 masked + 4 visible), 9+ return `****...xxx`

---

## Alternative Designs Considered

### BP-51-07: Threshold in SQL vs. client-side
- **Alternative**: Keep threshold in client-side JS filter (current behavior)
- **Decision**: SQL filter is better — reduces data transferred, leverages pgvector index. The client-side filter can be removed.

### BP-51-10: JOIN vs. correlated subqueries
- **Alternative**: Keep correlated subqueries (simpler SQL, no GROUP BY complexity)
- **Decision**: JOIN is better performance — N+1 subqueries run per agent row. With 100+ agents, this is 200+ extra queries.

---

*All 12 fixes are single-file changes. No new files, no new routes, no database migrations. Each fix follows existing code patterns.*
