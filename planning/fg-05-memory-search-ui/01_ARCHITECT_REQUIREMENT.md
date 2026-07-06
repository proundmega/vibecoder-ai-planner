# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: completed
**Date created**: 2026-06-19
**Date completed**: 2026-07-06
**Author**: AI Assistant
**Scope**: Frontend

> **NOTE**: Implementation is already complete. All code changes exist in HEAD. This document is preserved for historical reference only.
**Priority**: P2
**Effort**: Small

---

## Requirement

Add a search box to the Agent Memory tab in ProjectDetail.vue. The backend already has a search endpoint (`GET /api/v1/memory/project/:projectId/search?query=...`) and the frontend API client already exports `searchMemory()`, but neither the UI nor the event handler exists to trigger the search.

**Current behavior**: Users can list all memories for a project but cannot search within them.
**Expected behavior**: Users can enter a search query and see matching memories.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/memory.js:44` — YES (`GET /memory/project/:projectId/search`)
- [x] Controller exists: `backend/src/controllers/memoryController.js` — YES (`searchMemory`)
- [x] Service exists: `backend/src/services/MemoryService.js` — YES (`searchMemories`)
- [x] Route is mounted: `backend/src/api/v1/index.js:37` — YES (`/memory`)

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/memory.js` — YES
- [x] `searchMemory` function exported — YES (at line ~25)
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/ProjectDetail.vue` — YES (Memory tab at line ~612)
- [ ] Search UI exists — NO (needs to be added)
- [ ] Search event handler exists — NO (needs to be added)

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES (paths are correct)
- [x] Response shapes match — YES (returns array of memories)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **FRONTEND-ONLY task**. The backend API and frontend API client already exist. The task is to add a search input box to the Memory tab and wire it up to call `searchMemory()`.

**Example**: "The memory search API (`GET /api/v1/memory/project/:projectId/search?query=...`) already exists. The frontend API client `frontend/src/api/memory.js` exports `searchMemory()`. Add a search input to the Memory tab in `ProjectDetail.vue` and wire it to call `searchMemory()`."

---

## Scope

### In Scope
- [ ] Add search input box to the Memory tab in `frontend/src/views/ProjectDetail.vue`
- [ ] Add `searchQuery` state variable
- [ ] Add `handleSearch()` function that calls `searchMemory(projectId, searchQuery)`
- [ ] Display search results in the memory list (replace or filter the current list)
- [ ] Add "Clear" button to reset search and reload all memories

### Out of Scope
- Backend changes (API already exists)
- Advanced search (fuzzy matching, filters by date/agent)
- Search history

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add search input, handler, and result display to Memory tab (~line 612+) |
| `frontend/src/api/memory.js` | VERIFY | Verify `searchMemory` is exported (if missing, add it) |
| `database` | NONE | No schema changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Exact line numbers]**: The Memory tab section line numbers may have shifted. **Resolution**: grep for `Memory tab` or `memory-list` in ProjectDetail.vue to find the actual location.
2. **[searchMemory export]**: The API client may or may not export `searchMemory`. **Resolution**: Check `frontend/src/api/memory.js` — if missing, add the export.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

The search UI should follow the existing pattern in the Memory tab:
- Search input at the top of the memory list
- Results replace the full list when searching
- "Clear" button resets to show all memories

---

## Acceptance Criteria

1. [ ] [Frontend UI] Search input box appears at the top of the Memory tab
2. [ ] [Frontend UI] Typing in the search box and pressing Enter calls `searchMemory(projectId, query)`
3. [ ] [Frontend UI] Search results replace the full memory list
4. [ ] [Frontend UI] "Clear" button resets the search and reloads all memories
5. [ ] [Frontend UI] Empty search query shows all memories (same as no search)
6. [ ] [Frontend UI] Loading state while search is in progress
7. [ ] [Frontend UI] Error state if search fails
8. [ ] [Both] All tests pass
9. [ ] [Both] Linting passes
10. [ ] [Both] Frontend typecheck passes

---

## Out of Scope

- Backend changes to the search API
- Advanced search features (filters, sorting, pagination within results)
- Search history or recent searches
- Debounced/real-time search (Enter key search only)

---

## Performance Considerations

- Expected load: N/A — search triggered by user action, not automatic
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: NO — search results displayed as a list (backend handles pagination internally)

---

## Security Considerations

- Authentication required: YES (existing — memory endpoints are behind auth)
- Authorization check: YES (existing — project-level access control)
- Input validation: YES (existing — query parameter validated in backend)
- Rate limiting: N/A (search is user-triggered, not automatic)
- Sensitive data handling: No change — memory content is user-created, not secrets

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — no regressions
- [ ] Manual verification: Enter search query, verify matching memories displayed

### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify memory search response shape includes `id`, `content`, `metadata`, `agent_name`
- [ ] `frontend/src/api/validator.ts` — verify memory response schema matches backend

### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Creating a new API client** — `searchMemory` already exists in `frontend/src/api/memory.js`
- ❌ **Adding backend changes** — the search API already exists
- ❌ **Ignoring loading/error states** — search should show loading spinner and error messages
