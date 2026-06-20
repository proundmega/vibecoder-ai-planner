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
**Frontend API client already exists — no changes needed.**

#### Phase 1: Frontend UI

1. Verify `frontend/src/api/memory.js` exports `searchMemory`:
   ```javascript
   export function searchMemory(projectId, query) {
     return get(`/api/v1/memory/project/${projectId}/search`, { params: { query } })
   }
   ```
   If not exported, add it.

2. Update `frontend/src/views/ProjectDetail.vue` — Memory tab section (~line 612+):

   Add state variables:
   ```javascript
   const searchQuery = ref('')
   const searchResults = ref([])
   const isSearching = ref(false)
   ```

   Add search input at the top of the Memory tab:
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

   Add handler functions:
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

   Update the memory list to show search results when searching:
   ```vue
   <div v-if="isSearching" class="loading">Searching...</div>
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

#### Phase 2: Testing

3. Run frontend tests: `cd frontend && npm test -- --run`
4. Run frontend lint: `cd frontend && npm run lint`
5. Run frontend typecheck: `cd frontend && npm run typecheck`
6. Manual test: Enter search query in Memory tab, verify matching memories displayed

---

### c) Dependencies

- None — frontend-only task

---

### d) Risks/Edge Cases

- **[Risk]**: `searchMemory` not exported from API client
  **[Mitigation]**: Verify and add the export if missing

---

### e) Testing

#### Frontend Unit Tests
- [ ] `npm test -- --run` — no regressions

#### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

### f) Migration Notes

Not applicable — no database changes.

---

### g) Files Changed

**Frontend:**
```
frontend/src/api/memory.js        → verify searchMemory export (if missing, add it)
frontend/src/views/ProjectDetail.vue → add search input, handler, and result display
```

---

### h) Code Review Checklist

- [ ] Search input appears in Memory tab
- [ ] Enter key triggers search
- [ ] Search results displayed correctly
- [ ] Clear button resets to full list
- [ ] Loading and error states handled
- [ ] All tests pass
- [ ] No backend changes needed

---

### i) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] Navigate to Memory tab → search input visible
5. [ ] Enter search query → matching memories displayed
6. [ ] Click Clear → full memory list restored
