# 02_ARCHITECT_DESIGN.md — Billing Dashboard

**Status**: planned
**Date created**: 2026-06-24

## Problem

Users have no way to view their billing information. The backend API exists (`/billing/users/me/billing`) but has no frontend consumer. Billing data is currently only visible in ProjectDetail.vue per-project view.

## Current State

### Backend APIs (all working)
```
GET /api/v1/billing/projects/:id/billing   → ProjectDetail.vue (used)
GET /api/v1/billing/users/me/billing       → dead code (not imported)
```

### Frontend API Client
```javascript
// frontend/src/api/billing.js
export function getProjectBilling(projectId)  // used by ProjectDetail.vue
export function getUserBilling()              // dead
```

### Navigation
- No billing link in the nav bar
- Billing data only visible per-project in ProjectDetail.vue

## Design

### New Route and Page

**Route**: `/billing`
**Component**: `BillingDashboard.vue` — NEW
**Navigation**: Add "Billing" link to the nav bar (visible only to project_admin)

### Permission Model

- `project_admin` — can access their own project billing
- Other roles — redirected to dashboard with a message
- Check user role on mount: `if (authStore.user.role !== 'project_admin') redirect to /dashboard`

### Billing Dashboard Layout

```
┌─────────────────────────────────────────────────┐
│  Billing Dashboard                              │
├─────────────────────────────────────────────────┤
│  Billing Summary                                │
│  ┌───────────────────────────────────────────┐  │
│  │ Current Period: Jun 1 - Jun 30, 2026      │  │
│  │ Total Cost:          $1.25                │  │
│  │ Projects:            3 active             │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Per-Project Breakdown                          │
│  ┌──────────┬──────────┬──────────┐             │
│  │ Project  │ Period   │ Cost     │             │
│  ├──────────┼──────────┼──────────┤             │
│  │ ProjectA │ Jun 2026 │ $0.45    │             │
│  │ ProjectB │ Jun 2026 │ $0.32    │             │
│  │ ProjectC │ Jun 2026 │ $0.48    │             │
│  └──────────┴──────────┴──────────┘             │
└─────────────────────────────────────────────────┘
```

### Data Flow

```
BillingDashboard mounts → getUserBilling() →
  1. GET /billing/users/me/billing → user billing summary
  2. Render summary + per-project breakdown
```

### Component Structure

**Route**: `/billing` (standalone, not under projects)

**Component**: `BillingDashboard.vue` — NEW

**Layout**:
- Page header: "Billing Dashboard"
- Billing summary card (period, total cost, active projects)
- Per-project billing table
- Empty state: "No billing data available for the current period"

### API Integration

```javascript
// In BillingDashboard.vue:
import { getUserBilling } from '@/api/billing'

onMounted(async () => {
  try {
    const billing = await getUserBilling()
    billingData.value = billing
  } catch (err) {
    console.error('Failed to load billing data:', err)
    error.value = 'Failed to load billing data'
  }
})
```

### Navigation Integration

Add billing link to the nav bar:
- Visible only when `authStore.user.role === 'project_admin'`
- Route: `/billing`
- Icon: dollar sign or receipt

### Role Check Pattern

```javascript
// At top of BillingDashboard.vue script setup:
const authStore = useAuthStore()
const router = useRouter()

onMounted(() => {
  if (authStore.user?.role !== 'project_admin') {
    router.push('/dashboard')
    return
  }
  loadBillingData()
})
```

## Risk Assessment

- **Low risk** — backend already working, only new frontend page
- No new API routes
- No database changes
- Simple role check for access control

---

*Ready for implementation phase.*
