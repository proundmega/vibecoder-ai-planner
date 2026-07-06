# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The Agent Memory tab in ProjectDetail shows all memories for a project but has no search functionality. Users cannot filter memories by content. The backend search API and frontend API client already exist — only the UI is missing.

---

## Current State

### Existing Backend
- **Route**: `GET /api/v1/memory/project/:projectId/search?query=...` — `memoryController.searchMemory()`
- **Service**: `MemoryService.searchMemories(projectId, query)` — searches memory content
- **Response**: `{ success: true, data: [{ id, content, metadata, agent_name, ... }] }`

### Existing Frontend
- **API Client**: `frontend/src/api/memory.js:25` — `searchMemory(projectId, query)` exists but unused
- **UI**: `frontend/src/views/ProjectDetail.vue:612+` — Memory tab with memory list, no search box

### Gap Analysis
- Backend search API exists and works
- Frontend API client function exists but is never called
- No search UI in the Memory tab

---

## Design

### Option A: Add Search Input to Memory Tab (Recommended)

**Changes in `frontend/src/views/ProjectDetail.vue` (Memory tab section, ~line 612+):**

```vue
<!-- Add search input at the top of the Memory tab -->
<div class="memory-search">
  <input 
    v-model="searchQuery" 
    @keyup.enter="handleSearch"
    placeholder="Search memories..."
    class="search-input"
  />
  <button v-if="searchQuery" @click="clearSearch" class="clear-btn">Clear</button>
</div>

<!-- Memory list (existing, but conditional on search state) -->
<div v-if="searching" class="loading">Searching...</div>
<div v-else-if="searchResults.length > 0">
  <!-- Display search results -->
  <div v-for="memory in searchResults" :key="memory.id" class="memory-item">
    {{ memory.content }}
  </div>
</div>
<div v-else-if="!searchQuery && memories.length > 0">
  <!-- Display all memories (existing behavior) -->
</div>
<div v-else>No memories found</div>
```

**State variables to add:**
```javascript
const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)
const isSearching = ref(false) // to track in-progress search
```

**Handler function:**
```javascript
import { searchMemory } from '@/api/memory'

async function handleSearch() {
  if (!searchQuery.value.trim() || !activeProjectId.value) return
  isSearching.value = true
  try {
    const result = await searchMemory(activeProjectId.value, searchQuery.value)
    searchResults.value = result.data || []
  } catch (error) {
    memoryError.value = error.message
  } finally {
    isSearching.value = false
  }
}

function clearSearch() {
  searchQuery.value = ''
  searchResults.value = []
  loadMemories() // reload all memories
}
```

**Why this is the right choice**: Simple, follows existing patterns in the Memory tab. Uses the existing `searchMemory()` API client function.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add search input, handler, and result display to Memory tab (~line 612+) |
| `frontend/src/api/memory.js` | VERIFY | Verify `searchMemory` is exported (if missing, add it) |

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/memory.test.js` | API client `searchMemory` calls correct endpoint |
| Frontend contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Response shape includes `id`, `content`, `metadata` |
| Frontend component | Cypress | `frontend/cypress/component/` | Search input renders and triggers search |
| Frontend E2E | Cypress | `frontend/cypress/e2e/` | Full search flow: type → Enter → results → clear |

### Frontend-Backend Contract Testing

- Response schemas in `frontend/src/api/validator.ts` must include memory search result fields: `id`, `content`, `metadata`, `agent_name`
- If the contract test has a memory shape assertion, verify it matches the backend's actual response
- Generated TypeScript types from OpenAPI spec should include the memory search response — verify by running `npm run generate:spec && npm run generate:api && npm run typecheck`

---

## Security Considerations

- No new endpoints — existing auth/authorization applies unchanged
- No new data exposure — search returns same memory fields, just filtered
- Input validation unchanged — query parameter already validated in backend

---

## Data Flow Diagram

```
[User types in search box] → [Enter key triggers handleSearch()]
  → [searchMemory(projectId, query)]
  → [GET /api/v1/memory/project/:projectId/search?query=...]
  → [Backend searches memory content]
  → [Response: { data: [matching memories] }]
  → [UI displays search results]
```

---

## Dependencies

### Backend Dependencies
- None — search API already exists

### Frontend Dependencies
- `frontend/src/api/memory.js` — import `searchMemory`
- `frontend/src/views/ProjectDetail.vue` — add search UI to Memory tab

### Cross-Cutting Dependencies
- None

---

## Config / Environment Changes

- No env var changes
- No database migrations
- No npm dependency changes

---

## Risks and Edge Cases

### Frontend Risks
- **[Risk]**: `searchMemory` might not be exported from `frontend/src/api/memory.js`
  **[Mitigation]**: Verify the export exists. If not, add it.

### Integration Risks
- None

### Edge Cases
- Empty search query → show all memories (existing behavior)
- Search with no results → show "No memories found"
- Search in progress → show loading state
- Search fails → show error message (existing `memoryError` state)

---

## Alternative Designs Considered

### Alternative 1: Real-time search (debounced)
- **Pros**: More responsive UX
- **Cons**: More API calls, needs debounce logic
- **Decision**: Enter-key search is simpler and sufficient

### Alternative 2: Search as a filter (keeps full list visible)
- **Pros**: Users can compare search results with full list
- **Cons**: More complex UI, takes more space
- **Decision**: Replace the list with search results (simpler)

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file (if a small model will execute this ticket)

---

*This design document guides implementation. The task is adding a search input and handler to the existing Memory tab.*
