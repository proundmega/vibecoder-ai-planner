# bp-16-ui-navigation-merge — Implementation

## Phase 1: Backend (no changes needed)
No backend changes required. All APIs are route-agnostic.

## Phase 2: Frontend — ProjectDetail.vue

### Step 1: Remove `isChildRoute` conditionals for tabs

**File:** `frontend/src/views/ProjectDetail.vue`

**Before:**
```vue
<div v-if="!isChildRoute" class="tabs">
  <button v-for="tab in tabs" ...>{{ tab.label }}</button>
</div>

<router-view v-if="isChildRoute" />

<div v-if="!isChildRoute" class="tab-content">
  <!-- tab panels -->
</div>
```

**After:**
```vue
<div class="tabs">
  <button v-for="tab in tabs" :key="tab.id"
    :class="{ active: activeTab === tab.id }"
    @click="switchTab(tab.id)">
    {{ tab.label }}
  </button>
</div>

<!-- Show child route content OR tab content, not both -->
<router-view v-if="isChildRoute && activeTab === 'tickets'" />
<div v-else class="tab-content">
  <!-- tab panels (unchanged) -->
</div>
```

### Step 2: Add AI tab

**File:** `frontend/src/views/ProjectDetail.vue`

**Before:**
```javascript
const tabs = [
  { id: 'tickets', label: 'Tickets' },
  { id: 'github', label: 'GitHub' },
  { id: 'providers', label: 'AI Providers' },
  { id: 'usage', label: 'Usage & Billing' },
  { id: 'memory', label: 'Memory' },
]
```

**After:**
```javascript
const tabs = [
  { id: 'tickets', label: 'Tickets' },
  { id: 'github', label: 'GitHub' },
  { id: 'ai', label: 'AI Chat' },
  { id: 'providers', label: 'AI Providers' },
  { id: 'usage', label: 'Usage & Billing' },
  { id: 'memory', label: 'Memory' },
]
```

### Step 3: Update `switchTab` to handle AI tab

**Before:**
```javascript
async function switchTab(tabId) {
  if (activeTab.value === tabId) return
  if (tabId === 'github' && !githubLoaded.value) {
    await loadGitHub()
    githubLoaded.value = true
  } else if (tabId === 'providers' && !providersLoaded.value) {
    await loadProviders()
    providersLoaded.value = true
  } else if (tabId === 'usage' && !usage.value) {
    await loadUsage()
    await loadBilling()
  } else if (tabId === 'memory' && !memoryLoaded.value) {
    await loadMemory()
    memoryLoaded.value = true
  }
  activeTab.value = tabId
}
```

**After:**
```javascript
async function switchTab(tabId) {
  if (activeTab.value === tabId) return
  if (tabId === 'github' && !githubLoaded.value) {
    await loadGitHub()
    githubLoaded.value = true
  } else if (tabId === 'providers' && !providersLoaded.value) {
    await loadProviders()
    providersLoaded.value = true
  } else if (tabId === 'usage' && !usage.value) {
    await loadUsage()
    await loadBilling()
  } else if (tabId === 'memory' && !memoryLoaded.value) {
    await loadMemory()
    memoryLoaded.value = true
  }
  // AI tab doesn't need loading — it renders via router-view
  activeTab.value = tabId
}
```

### Step 4: Update `onMounted` to load AI tab data

No changes needed — AIAssistant.vue loads its own data in its own `onMounted`.

### Step 5: Add AI tab content panel (optional, for direct `/projects/:id/ai` access)

The AI tab content can be rendered via the existing router-view when on `/projects/:id/ai`. No additional panel needed.

## Phase 3: Frontend — Router (no changes needed)

The current router already supports nested children:
```typescript
{
  path: '/projects/:id',
  component: ProjectDetail,
  children: [
    { path: 'tickets', component: TicketBoard },
    { path: 'tickets/:ticketId', component: TicketDetail },
    { path: 'ai', component: AIAssistant },
  ],
}
```

This structure works with the new tab approach. The `isChildRoute` computed property will correctly identify when a child route is active.

## Phase 4: Frontend — AIAssistant.vue (no changes needed)

AIAssistant.vue renders inside `<router-view>` when navigating to `/projects/:id/ai`. With tabs always visible, it will appear as:
```
[ Tickets | GitHub | AI Chat | Providers | Usage | Memory ]
[ AI Assistant chat interface (from AIAssistant.vue) ]
```

## Rollback Plan

If the changes cause issues:
1. Revert `ProjectDetail.vue` changes — restore `v-if="!isChildRoute"` conditionals
2. Remove AI tab from tabs array
3. No database or backend changes to rollback

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/views/ProjectDetail.vue` | Remove `isChildRoute` tab conditionals, add AI tab |
| `frontend/src/router/index.ts` | No changes |
| `frontend/src/views/AIAssistant.vue` | No changes |

## Testing

After implementation:
1. `cd frontend && npm run lint` — no lint errors
2. `cd frontend && npm run typecheck` — no type errors
3. `cd frontend && npm test -- --run` — all Vitest tests pass
4. Navigate to `/projects/:id` — tabs visible
5. Navigate to `/projects/:id/tickets/:ticketId` — tabs visible, ticket detail renders
6. Click each tab — correct content renders
7. Click "AI Chat" tab — AIAssistant renders
8. Browser back button works correctly
