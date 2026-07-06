# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-05 — Add search UI to Agent Memory tab

**Status**: planned | in_progress | completed | blocked
**Priority**: P2
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Add a search box to the Agent Memory tab so users can search memories by content. The backend search API and frontend API client already exist — only the UI is missing.

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Verify searchMemory export]** — `frontend/src/api/memory.js`
   - Check if `searchMemory(projectId, query)` is exported
   - If not exported, add: `export function searchMemory(projectId, query) { return get(...) }`
   - *Depends on*: nothing

2. **[Add search UI to Memory tab]** — `frontend/src/views/ProjectDetail.vue`
   - Find the Memory tab section (~line 612+, grep for `Memory tab` or `memory-list`)
   - Add state variables: `searchQuery`, `searchResults`, `isSearching`
   - Add search input at the top of the Memory tab
   - Add `handleSearch()` and `clearSearch()` functions
   - Update memory list to show search results when searching
   - *Depends on*: Step 1

3. **[Run verification]** — `cd frontend`
   - `npm test -- --run` — no regressions
   - `npm run lint` — no lint errors
   - `npm run typecheck` — no TS errors
   - *Depends on*: Steps 1, 2

---

### c) Per-File Action Plan

#### `frontend/src/api/memory.js` (VERIFY or MODIFY)
- **Change**: Verify `searchMemory` is exported, add if missing
- **Position**: End of file (if adding export)
- **If adding export**:
  ```javascript
  import { get } from './client'

  export function searchMemory(projectId, query) {
    return get(`/api/v1/memory/project/${projectId}/search`, { params: { query } })
  }
  ```
- **Imports needed**: `get` from `./client` (if adding export)

#### `frontend/src/views/ProjectDetail.vue` (MODIFY)
- **Change**: Add search input, handler, and result display to Memory tab
- **Position**: Memory tab section (~line 612+)
- **State variables to add**:
  ```javascript
  const searchQuery = ref('')
  const searchResults = ref([])
  const isSearching = ref(false)
  ```
- **Import to add**: `import { searchMemory } from '@/api/memory'`
- **Handler functions to add**:
  ```javascript
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
    loadMemories()
  }
  ```
- **Template to add** (search input at top of Memory tab):
  ```vue
  <div class="memory-search">
    <input 
      v-model="searchQuery" 
      @keyup.enter="handleSearch"
      placeholder="Search memories..."
      class="search-input"
    />
    <button v-if="searchQuery" @click="clearSearch" class="clear-btn">Clear</button>
  </div>
  ```
- **Memory list update** (conditional display):
  ```vue
  <div v-if="isSearching" class="loading">Searching...</div>
  <div v-else-if="searchResults.length > 0">
    <div v-for="memory in searchResults" :key="memory.id" class="memory-item">
      {{ memory.content }}
    </div>
  </div>
  <div v-else-if="!searchQuery && memories.length > 0">
    <!-- Display all memories (existing behavior) -->
  </div>
  <div v-else>No memories found</div>
  ```
- **Imports needed**: `searchMemory` from `@/api/memory`

---

### d) Dependencies

- None — this is a frontend-only task, no backend changes, no new dependencies

---

### e) Risks/Edge Cases

- **[Risk]**: `searchMemory` not exported from API client
  **[Mitigation]**: Verify and add the export if missing

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- No backend changes — existing tests should pass

#### Backend Jest Integration Tests
- N/A — no backend changes

#### Backend Bash Integration Suite
- N/A — no backend API changes

#### Frontend Unit Tests
- [ ] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/memory.test.js`
- [ ] If `memory.test.js` exists: add test case verifying `searchMemory()` calls correct endpoint

#### Frontend E2E Tests
- [ ] Manual: Enter search query in Memory tab, verify matching memories displayed
- [ ] Manual: Click Clear button, verify full memory list restored

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify memory search response shape includes `id`, `content`, `metadata`, `agent_name`
- [ ] `frontend/src/api/validator.ts` — verify memory response schema matches backend

---

### g) Migration Notes

Not applicable — no database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/api/memory.js        → VERIFY: searchMemory export (if missing, add it)
frontend/src/views/ProjectDetail.vue → MODIFY: add search input, handler, and result display to Memory tab
```

---

### i) Code Review Checklist

- [ ] Search input appears in Memory tab at the top of the list
- [ ] Enter key triggers `handleSearch()`
- [ ] Search results displayed correctly when results exist
- [ ] Clear button resets search and reloads all memories
- [ ] Loading state shown while search is in progress
- [ ] Error state shown if search fails (uses existing `memoryError`)
- [ ] Empty search query shows all memories (existing behavior)
- [ ] No backend changes needed
- [ ] Frontend API client follows existing patterns (`get`, `post`, `put`, `del`, `patch` from `./client`)
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] All tests written and passing — existing tests still pass
- [ ] OpenAPI spec regenerated if backend routes changed (N/A — no backend changes)
- [ ] Generated TypeScript types regenerated if response shapes changed (N/A — no backend changes)
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes (N/A — no backend changes)
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers memory search response shape
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] `cd frontend && npm run build` passes
5. [ ] Navigate to Memory tab → search input visible at top
6. [ ] Enter search query and press Enter → matching memories displayed
7. [ ] Click Clear button → full memory list restored
8. [ ] Verify no console errors for search API calls

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
