# 02_ARCHITECT_DESIGN.md — Usage Dashboard

**Status**: planned
**Date created**: 2026-06-24

## Problem

The Dashboard page only shows a list of projects. Users have no way to see usage statistics or model pricing from the main entry point. The backend APIs exist (`/usage/users/me/usage`, `/usage/pricing/models`) but have no frontend consumer.

## Current State

### Backend APIs (all working)
```
GET /api/v1/usage/projects/:id/usage   → ProjectDetail.vue (used)
GET /api/v1/usage/users/me/usage       → dead code (not imported)
GET /api/v1/usage/pricing/models       → dead code (not imported)
```

### Frontend API Client
```javascript
// frontend/src/api/usage.js
export function getProjectUsage(projectId)  // used by ProjectDetail.vue
export function getUserUsage()              // dead
export function getModelPricing()           // dead
```

### Dashboard.vue
- Shows project list
- Has no tabs — just a page with projects
- Navigation: `/dashboard`

## Design

### Usage Tab in Dashboard

Add a tabbed interface to Dashboard.vue with 3 tabs:

| Tab | Label | Content |
|-----|-------|---------|
| 1 | Projects | Existing project list |
| 2 | Usage | Per-project usage stats + pricing table |
| 3 | Pricing | Model pricing reference (or merge into Usage) |

Actually, since the user said "a separate tab in the main dashboard", I'll add 2 tabs:

**Tab 1: Projects** — existing project list (unchanged)
**Tab 2: Usage** — new usage stats + pricing table

### Usage Tab Layout

```
┌─────────────────────────────────────────────┐
│  Usage Dashboard                            │
├─────────────────────────────────────────────┤
│  Per-Project Usage                          │
│  ┌──────────┬──────────┬──────────┐         │
│  │ Project  │ Tokens   │ Cost     │         │
│  ├──────────┼──────────┼──────────┤         │
│  │ ProjectA │ 1.2M     │ $0.45    │         │
│  │ ProjectB │ 850K     │ $0.32    │         │
│  └──────────┴──────────┴──────────┘         │
│                                             │
│  Model Pricing Reference                    │
│  ┌──────────────┬──────────┬──────────┐     │
│  │ Model        │ Input    │ Output   │     │
│  ├──────────────┼──────────┼──────────┤     │
│  │ gpt-4o       │ $2.50    │ $10.00   │     │
│  │ claude-3     │ $3.00    │ $15.00   │     │
│  └──────────────┴──────────┴──────────┘     │
└─────────────────────────────────────────────┘
```

### Data Flow

```
Dashboard mounts → loadUsageData() →
  1. GET /usage/users/me/usage → total user usage
  2. GET /usage/projects/:id/usage → per-project usage
  3. GET /usage/pricing/models → pricing table
```

### Usage Tab Component

**Route**: `/dashboard` (same route, new tab within Dashboard.vue)

**Component**: `Dashboard.vue` — add tab state + usage logic

**Layout**:
- Tab navigation: "Projects" | "Usage"
- "Usage" tab content:
  - Section 1: Per-project usage table
  - Section 2: Model pricing reference table

### API Integration

```javascript
// In Dashboard.vue:
import { getUserUsage, getModelPricing } from '@/api/usage'

async function loadUsageData() {
  const [userUsage, pricing] = await Promise.all([
    getUserUsage(),
    getModelPricing()
  ])
  // Also fetch per-project usage for each project
  const projectUsages = await Promise.all(
    projects.value.map(p => getProjectUsage(p.id))
  )
}
```

### Permission Model

No new permissions needed. All existing usage endpoints use `verifyToken` only.

### Styling

Follow existing Dashboard.vue patterns:
- Use existing card/table classes
- Keep consistent with ProjectDetail.vue tab styling
- Responsive table with horizontal scroll on small screens

## Risk Assessment

- **Low risk** — only frontend changes, backend already working
- No new API routes
- No database changes
- No permission changes

---

*Ready for implementation phase.*
