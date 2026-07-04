# bp-16-ui-navigation-merge — Design

## Problem Statement
The current navigation structure hides project-level tabs when users drill into child routes (tickets, AI). This creates a fragmented experience where users can't switch between ticket work and project settings without navigating all the way back.

## Current State

### Route structure
```
/projects/:id          → ProjectDetail.vue (tabs visible, isChildRoute=false)
  /tickets             → TicketBoard.vue (tabs hidden)
  /tickets/:ticketId   → TicketDetail.vue (tabs hidden)
  /ai                  → AIAssistant.vue (tabs hidden)
```

### ProjectDetail.vue tabs (5)
- **Tickets** — link to Kanban board
- **GitHub** — repo connection, branches, PRs
- **AI Providers** — manage API keys
- **Usage & Billing** — cost tracking
- **Memory** — shared agent memory

### AIAssistant.vue (separate page)
- Agent selector dropdown
- Chat interface with message history
- Quick actions (Random Task, Send)
- Daily usage stats

### The `isChildRoute` problem
```javascript
const isChildRoute = computed(() => route.name !== 'ProjectDetail')
// ...
<div v-if="!isChildRoute" class="tabs">...</div>
<router-view v-if="isChildRoute" />
```
When `route.name` is anything other than `'ProjectDetail'`, tabs are hidden and only the child `<router-view>` renders.

### AIAssistant duplication
AIAssistant.vue at `/projects/:id/ai` provides an AI chat interface, while ProjectDetail has an "AI Providers" tab for managing credentials. These are related but disconnected — the user must know about the separate `/ai` route to access the chat.

## Design

### Option 1: Always-visible tabs (Recommended)

Keep tabs visible on all child routes. The tab content area shows either:
- The selected tab's content (when on project root)
- The child route content (when on a child route)

```
/projects/:id          → tabs visible, ProjectDetail content
/projects/:id/tickets  → tabs visible, TicketBoard in main area
/projects/:id/tickets/:ticketId → tabs visible, TicketDetail in main area
/projects/:id/ai       → tabs visible, AIAssistant in main area
```

**Implementation:**
1. Remove `isChildRoute` conditional for tabs — always render tabs
2. Keep `<router-view>` as the main content area (replaces tab content panels)
3. Rename `AIAssistant.vue` route from `/ai` to align with tab structure
4. Add "AI" tab to ProjectDetail tabs list
5. When "AI" tab is active AND no child route is matched, show AIAssistant content
6. When on a child route (tickets, tickets/:ticketId), show that content regardless of active tab

### Option 2: Separate nav bar

Add a secondary navigation bar above content that shows project tabs regardless of route. This is more complex and requires duplicating tab state across components.

### Option 3: Sidebar navigation

Move tabs to a left sidebar that's always visible. This is a larger UI change and out of scope.

## Recommended Approach: Option 1

### Changes

**1. ProjectDetail.vue — tab rendering**
```vue
<!-- BEFORE -->
<div v-if="!isChildRoute" class="tabs">...</div>
<router-view v-if="isChildRoute" />
<div v-if="!isChildRoute" class="tab-content">...</div>

<!-- AFTER -->
<div class="tabs">...</div>
<router-view />
<!-- tab-content panels stay as fallback for direct tab clicks -->
```

**2. ProjectDetail.vue — add AI tab**
```javascript
const tabs = [
  { id: 'tickets', label: 'Tickets' },
  { id: 'github', label: 'GitHub' },
  { id: 'ai', label: 'AI Chat' },        // NEW
  { id: 'providers', label: 'AI Providers' },
  { id: 'usage', label: 'Usage & Billing' },
  { id: 'memory', label: 'Memory' },
]
```

**3. Router — consolidate AI routes**
```typescript
// BEFORE
{ path: 'ai', name: 'AIAssistant', component: () => import('../views/AIAssistant.vue') }

// AFTER — merge AIAssistant content into ProjectDetail's AI tab
// The /projects/:id/ai route still works but shows AIAssistant content
// within ProjectDetail's layout (tabs + AI content)
```

**4. AIAssistant.vue — keep as standalone component**
- Keep the file as-is
- It renders inside the `<router-view>` when on `/projects/:id/ai`
- Tabs remain visible above it

### Data flow
```
User clicks ticket
  → Router navigates to /projects/:id/tickets/:ticketId
  → ProjectDetail.vue renders (tabs visible)
  → <router-view> renders TicketDetail.vue
  → User clicks "GitHub" tab
  → activeTab = 'github'
  → Tab content panel for GitHub renders (router-view hidden or overlaid)
```

### Edge cases
- **Direct URL to `/projects/:id/ai`** — shows AIAssistant in router-view, tabs visible
- **Direct URL to `/projects/:id`** — shows tab content (default: Tickets → link to board)
- **Browser back from ticket detail** — goes to ticket board (same project), tabs still visible
- **Tab click while on child route** — shows tab content, hides child route content

## Risks & Edge Cases

1. **Tab state vs route state conflict** — If user is on `/projects/:id/tickets/123` and clicks "GitHub" tab, should we navigate to `/projects/:id/github`? No — `github` is not a route, it's a tab panel. The child route content should be hidden when a non-ticket tab is active.

2. **AIAssistant agent selector** — The agent selector in AIAssistant uses `listAgents()` which is project-level. This works fine within the tab structure.

3. **Deep linking** — Bookmarking `/projects/:id/tickets/123` should still work. The ticket detail renders in router-view, tabs visible.

4. **Multiple child routes** — Only one child route can be active at a time (enforced by router).

## Files to Change

1. `frontend/src/views/ProjectDetail.vue` — Remove `isChildRoute` conditionals, add AI tab
2. `frontend/src/router/index.ts` — No changes needed (routes already support nested children)
3. `frontend/src/views/AIAssistant.vue` — No changes needed (renders in router-view)
4. `frontend/src/views/TicketDetail.vue` — No changes needed
5. `frontend/src/views/TicketBoard.vue` — No changes needed
