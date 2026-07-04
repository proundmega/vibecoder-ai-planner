# bp-34: Code Review UI — GitHub PR Diff — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

The ticket has `pr_url` and `pr_state` columns (set by `GitHubService.createTicketPR()`). The review phase exists in the phase machine (bp-26) but has no UI — it's a status toggle. The `ticket_comments` table stores flat comments with only `content` and `user_id` — no file path or line number.

```
PhaseFlow.vue shows review phase as:  [human_approval]  [backlog]
No diff. No line comments. No approve/reject UI.
```

## Proposed Solution

### Backend: Diff Proxy Endpoint

**New method on GitHubService:**
```javascript
async getPRDiff(projectId, ticketId)
  1. Get repo + ticket from DB
  2. Extract PR number from ticket.pr_url (parse GH URL pattern)
  3. Call GitHubProvider.getDiff(repo, prNumber)
  4. Return structured result: [{ filename, status, additions, deletions, patch }]
```

**New endpoint in tickets.js:**
```
GET /api/v1/tickets/:ticketId/review/diff
  → calls GitHubService.getPRDiff()
  → returns { files: [{ filename, status, patch, additions, deletions }] }
```

The raw patch from GitHub's API is already in unified diff format. We pass it to the frontend, which renders it with diff2html.

### Frontend: DiffViewer.vue Component

```
Props:
  files: Array<{ filename, status, patch, additions, deletions }>
  viewMode: 'split' | 'unified'  (default: 'split')
  showLineNumbers: boolean (default: true)
  
Events:
  @line-click(filename, lineNumber) → emitted when user clicks a line number
  @file-expand(filename) → emitted when user expands a collapsed file

Slots:
  #line-actions({ filename, lineNumber }) → slot for comment buttons per line
```

Uses `diff2html` library with custom CSS overrides. Each file is a collapsible section. Lines with comments show a comment indicator icon.

### Frontend: CodeReview.vue Page

```
Route: /projects/:projectId/tickets/:ticketId/review

Layout:
  ┌────────────────────────────────────────────┐
  │  Ticket #1234: [title]          [Approve]  │
  │  PR #42 · 12 files · +340 -12  [Changes]  │
  ├────────────────────────────────────────────┤
  │  [Unified] [Split]   [▼ Collapse All]      │
  │  ┌────────────────────────────────────────┐ │
  │  │ src/foo.ts (+120 -5)                   │ │
  │  │ @@ -10,7 +10,15 @@                     │ │
  │  │  ... diff content ...                   │ │
  │  │  [💬 Comment on line 42]               │ │
  │  │  ┌──────────────────────────────────┐   │ │
  │  │  │ User: This should use the       │   │ │
  │  │  │ existing helper function instead │   │ │
  │  │  └──────────────────────────────────┘   │ │
  │  └────────────────────────────────────────┘ │
  │  ... more files ...                         │
  ├────────────────────────────────────────────┤
  │  [← Request Changes]        [✓ Approve]    │
  └────────────────────────────────────────────┘
```

### Line-Level Commenting

Reuse existing `POST /api/v1/tickets/:id/comments` but add fields:
```json
{
  "content": "This should use the existing helper",
  "file_path": "src/foo.ts",
  "line_number": 42
}
```

Modify `commentSchema` to accept optional `file_path` (string) and `line_number` (integer). Existing comments (no file_path) render as ticket-level comments as before.

Fetch comments with `GET /api/v1/tickets/:id/comments?type=review` to get file-level comments, grouped by file_path → line_number.

### Approve / Request Changes

**Approve:**
```
POST /api/v1/tickets/:id/phases/transition
{ toPhase: "human_approval", metadata: { action: "approved" } }
```

**Request changes:**
```
POST /api/v1/tickets/:id/phases/transition
{ toPhase: "in_progress", metadata: { action: "changes_requested", reason: "..." } }
```

Add a summary comment with the reason automatically.

### Data Flow

```
Frontend                     Backend                     GitHub
   │                           │                          │
   │ GET /review/diff          │                          │
   │──────────────────────────►│ GET /repos/{owner}/{repo}/pulls/{number}/files
   │                           │─────────────────────────►│
   │                           │◄─────────────────────────│
   │◄──────────────────────────│ { files: [{ patch, ... }] }
   │                           │                          │
   │ Render with diff2html     │                          │
   │                           │                          │
   │ User clicks line 42       │                          │
   │ POST /comments            │                          │
   │ { file_path, line_number }│                          │
   │──────────────────────────►│ INSERT INTO ticket_comments
   │◄──────────────────────────│ { id, ... }              │
   │                           │                          │
   │ User clicks Approve       │                          │
   │ POST /phases/transition   │                          │
   │──────────────────────────►│ PhaseService.transition()
   │◄──────────────────────────│ { to: "human_approval" } │
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/api/tickets.js` | MODIFY | Add GET /:ticketId/review/diff |
| `backend/src/services/GitHubService.js` | MODIFY | Add getPRDiff() using GitHubProvider |
| `backend/src/validators/tickets.js` | MODIFY | Add file_path, line_number to commentSchema |
| `backend/src/controllers/ticketController.js` | MODIFY | Add getReviewDiff handler |
| `frontend/src/views/CodeReview.vue` | CREATE | Full review page component |
| `frontend/src/components/DiffViewer.vue` | CREATE | Reusable diff rendering |
| `frontend/src/api/review.js` | CREATE | API client with getDiff, getComments, postComment |
| `frontend/src/router/index.ts` | MODIFY | Add /projects/:id/tickets/:id/review route |
