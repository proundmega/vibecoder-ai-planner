# 02_ARCHITECT_DESIGN.md — GitHub Connections

**Status**: completed
**Date created**: 2026-06-24

## Problem

The GitHub tab in ProjectDetail.vue is limited — it shows repo status, branches, and PRs but lacks branch deletion and PR creation capabilities. The API functions exist (`deleteBranch()`, `createPR()`) but are never imported. Users need a dedicated GitHub management page.

## Current State

### GitHub Tab in ProjectDetail.vue
- Shows repo status (connected/disconnected)
- Connect/disconnect repo form
- List branches (no delete)
- List PRs (no create)
- Create branch form

### Dead API Functions
```javascript
// frontend/src/api/github.js
export function deleteBranch(ticketId)     // dead — never imported
export function createPR(ticketId, title, body, branchName)  // dead — never imported
```

### GitHubController (backend — all working)
```
DELETE /:ticketId/branch  → githubController.deleteBranch
POST   /:ticketId/pr     → githubController.createPR
```

## Design

### New Route and Page

**Route**: `/projects/:id/github`
**Component**: `GitHubConnections.vue` — NEW
**Navigation**: Link from ProjectDetail.vue GitHub tab

### GitHub Connections Page Layout

```
┌─────────────────────────────────────────────────┐
│  GitHub Connections                             │
├─────────────────────────────────────────────────┤
│  Repository                                     │
│  ┌───────────────────────────────────────────┐  │
│  │ Status: Connected                         │  │
│  │ Repo:       owner/repo                    │  │
│  │ Branch:     main                          │  │
│  │ [Disconnect]                              │  │
│  └───────────────────────────────────────────┘  │
│  (or connect form if not connected)             │
│                                                 │
│  Branches                                       │
│  ┌───────────────────────────────────────────┐  │
│  │ ticket/123/fix-login      [Delete]        │  │
│  │ ticket/124/add-search     [Delete]        │  │
│  │ main                                          │  │
│  └───────────────────────────────────────────┘  │
│  [Create Branch] → modal with ticket select     │
│                                                 │
│  Pull Requests                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ #42  fix-login      open    ticket/123    │  │
│  │ #43  add-search     open    ticket/124    │  │
│  └───────────────────────────────────────────┘  │
│  [Create PR] → modal with ticket select         │
└─────────────────────────────────────────────────┘
```

### Data Flow

```
GitHubConnections mounts →
  1. GET /github/:projectId/repo → repo status
  2. GET /github/:projectId/branches → branch list
  3. GET /github/:projectId/prs → PR list
  4. On delete: DELETE /github/:ticketId/branch
  5. On create branch: POST /github/:ticketId/branch
  6. On create PR: POST /github/:ticketId/pr
  7. On connect: POST /github/:projectId/repo/connect
  8. On disconnect: DELETE /github/:projectId/repo
```

### Component Structure

**Route**: `/projects/:id/github` (child of ProjectDetail)

**Component**: `GitHubConnections.vue` — NEW

**Layout**:
- Page header: "GitHub Connections"
- Section 1: Repository status + connect/disconnect
- Section 2: Branches list + create branch
- Section 3: PRs list + create PR

### Wire Up Dead Functions

In `frontend/src/api/github.js`, `deleteBranch()` and `createPR()` already exist:
```javascript
export function deleteBranch(ticketId) {
  return client.del(`/github/${ticketId}/branch`)
}

export function createPR(ticketId, title, body, branchName) {
  return client.post(`/github/${ticketId}/pr`, { title, body, branchName })
}
```

Just need to import and use them in the new component.

### ProjectDetail.vue Integration

In the GitHub tab, add a "Manage GitHub" link or button:
```vue
<router-link :to="`/projects/${projectId}/github`">
  Manage GitHub
</router-link>
```

This keeps the existing GitHub tab as a summary view while the new page is the full management interface.

### Permission Model

Uses `PROJECT_MANAGE_MEMBERS` permission (same as connect/disconnect):
- `member` role and above can manage GitHub connections
- `user` role cannot connect/disconnect (but can view status)

## Risk Assessment

- **Medium risk** — new page, extracts and extends existing GitHub tab
- `deleteBranch()` and `createPR()` already exist in backend
- No database changes
- No new API routes

---

*Ready for implementation phase.*
