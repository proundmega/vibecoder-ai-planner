# 02_ARCHITECT_DESIGN.md — Approvals Queue

**Status**: completed
**Date created**: 2026-06-24

## Problem

Users can't see all pending approvals in one place. TicketDetail.vue shows approvals per-ticket, but there's no queue view. The backend APIs for listing pending approvals and approving/rejecting exist but have no frontend consumer.

## Current State

### Backend APIs (all working)
```
GET    /api/v1/approvals/pending        → list all pending approvals
GET    /api/v1/approvals/ticket/:id     → list approvals for a ticket
POST   /api/v1/approvals/:id/approve    → approve (APPROVAL_APPROVE)
POST   /api/v1/approvals/:id/reject     → reject (APPROVAL_REJECT)
POST   /api/v1/approvals                → create approval request
```

### Frontend API Client
```javascript
// frontend/src/api/approvals.js
export function createApproval(ticketId)              // used by TicketDetail.vue
export function getPendingApprovals()                 // dead
export function getTicketApprovals(ticketId)          // used by TicketDetail.vue
export function approveRequest(approvalId)            // dead
export function rejectRequest(approvalId)             // dead
```

### TicketDetail.vue
- Shows per-ticket approvals
- Has "Request Approval" button

## Design

### Two Pages

#### 1. Global Approvals Queue

**Route**: `/approvals`
**Component**: `ApprovalsQueue.vue` — NEW
**Access**: super_admin (global), all logged-in users can see pending (backend has no permission check on `/pending`)
**Navigation**: Add "Approvals" link to nav bar

**Layout**:
```
┌───────────────────────────────────────────────────────┐
│  Approvals Queue                                      │
├───────────────────────────────────────────────────────┤
│  Pending Approvals                                    │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Ticket #123  - "Fix login bug"                  │  │
│  │ Project: ProjectA                               │  │
│  │ Requested by: John Doe                          │  │
│  │ [Approve] [Reject]                              │  │
│  ├─────────────────────────────────────────────────┤  │
│  │ Ticket #124  - "Add search"                     │  │
│  │ Project: ProjectB                               │  │
│  │ Requested by: Jane Smith                        │  │
│  │ [Approve] [Reject]                              │  │
│  └─────────────────────────────────────────────────┘  │
│  Empty: "No pending approvals"                        │
└───────────────────────────────────────────────────────┘
```

#### 2. Per-Project Approvals

**Route**: `/projects/:id/approvals`
**Component**: `ProjectApprovals.vue` — NEW
**Access**: project_admin + member (same as project access)
**Navigation**: Link from ProjectDetail.vue

**Layout**:
```
┌───────────────────────────────────────────────────────┐
│  Project Approvals                                    │
│  Project: ProjectA                                    │
├───────────────────────────────────────────────────────┤
│  Pending Approvals                                    │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Ticket #123  - "Fix login bug"                  │  │
│  │ Requested by: John Doe                          │  │
│  │ [Approve] [Reject]                              │  │
│  └─────────────────────────────────────────────────┘  │
│  Empty: "No pending approvals for this project"       │
└───────────────────────────────────────────────────────┘
```

### Data Flow

```
ApprovalsQueue mounts → getPendingApprovals() →
  1. GET /approvals/pending → all pending approvals
  2. On approve: POST /approvals/:id/approve
  3. On reject: POST /approvals/:id/reject

ProjectApprovals mounts → getPendingApprovals() →
  1. GET /approvals/pending → all pending approvals (filter by project)
  2. On approve: POST /approvals/:id/approve
  3. On reject: POST /approvals/:id/reject
```

### Component Structure

**Route**: `/approvals` (global, standalone)
**Component**: `ApprovalsQueue.vue` — NEW

**Route**: `/projects/:id/approvals` (child of ProjectDetail)
**Component**: `ProjectApprovals.vue` — NEW

### Wire Up Dead Functions

```javascript
// frontend/src/api/approvals.js — already exists, just need imports:
export function getPendingApprovals() {
  return client.get('/approvals/pending')
}

export function approveRequest(approvalId) {
  return client.post(`/approvals/${approvalId}/approve`)
}

export function rejectRequest(approvalId) {
  return client.post(`/approvals/${approvalId}/reject`)
}
```

### Permission Model

- **Global page** (`/approvals`): all logged-in users can view pending approvals (backend has no permission check on `/pending`)
- **Per-project page** (`/projects/:id/approvals`): project access (same as ticket access)
- **Approve/Reject**: requires `APPROVAL_APPROVE` / `APPROVAL_REJECT` permissions (backend enforces)
- Default roles: `member` and `project_admin` have `APPROVAL_APPROVE` and `APPROVAL_REJECT`

### ProjectDetail.vue Integration

Add links in the Tickets tab or a new Approvals tab:
```vue
<router-link :to="`/projects/${projectId}/approvals`">
  View All Approvals
</router-link>
```

## Risk Assessment

- **Low risk** — backend APIs already exist, only frontend changes
- No new API routes
- No database changes
- Simple approval flow with existing backend logic

---

*Ready for implementation phase.*
