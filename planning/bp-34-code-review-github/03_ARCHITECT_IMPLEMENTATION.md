# bp-34: Code Review UI — GitHub PR Diff — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

## Purpose
Render GitHub PR diffs in a review UI with line commenting, approve, and request-changes actions.

## Implementation Order

1. **Add `getPRDiff()` to GitHubService** — `backend/src/services/GitHubService.js`
   - Parse PR number from `ticket.pr_url` (format: `https://github.com/owner/repo/pull/123`)
   - Call `GitHubProvider.getDiff()` which fetches `GET /repos/{owner}/{repo}/pulls/{number}/files`
   - Return structured file list with patches
   - *Depends on*: nothing

2. **Add review diff endpoint** — `backend/src/api/tickets.js`
   - `GET /:ticketId/review/diff` → calls GitHubService.getPRDiff()
   - Handle missing PR or ticket gracefully (404s)
   - *Depends on*: Step 1

3. **Update comment schema** — `backend/src/validators/tickets.js`
   - Add optional `file_path` (string, max 512) and `line_number` (integer, min 1) to commentSchema
   - *Depends on*: nothing

4. **Update comments query** — `backend/src/controllers/ticketController.js`
   - Support `?type=review` filter to get only file-level comments
   - Return comments grouped by file_path for easier frontend rendering
   - *Depends on*: Step 3

5. **Create DiffViewer.vue** — `frontend/src/components/DiffViewer.vue`
   - Wrap diff2html library
   - Emit line-click events
   - Support split/unified toggle
   - Collapsible file sections
   - *Depends on*: nothing (pure component)

6. **Create review API client** — `frontend/src/api/review.js`
   - `getGithubDiff(ticketId)`, `getComments(ticketId)`, `postComment(ticketId, data)`
   - *Depends on*: Steps 1-3

7. **Create CodeReview.vue** — `frontend/src/views/CodeReview.vue`
   - Load diff + comments on mount
   - Render DiffViewer with inline comments
   - Approve / Request Changes buttons
   - *Depends on*: Steps 5, 6

8. **Add review route** — `frontend/src/router/index.ts`
   - `/projects/:projectId/tickets/:ticketId/review` → CodeReview.vue
   - Requires auth + TICKET_VIEW permission
   - *Depends on*: Step 7

## Per-File Action Plan

### `backend/src/services/GitHubService.js` (MODIFY)

Add `getPRDiff(projectId, ticketId)`:
```javascript
async getPRDiff(projectId, ticketId) {
  const repo = await this.getProjectRepo(projectId);
  if (!repo) throw new ValidationError('No repository connected');
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (!ticket.prUrl) throw new ValidationError('No PR linked to this ticket');
  
  const prNumber = this._extractPRNumber(ticket.prUrl);
  const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
  return provider.getDiff(repo, prNumber);
}

_extractPRNumber(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  if (!match) throw new ValidationError('Invalid PR URL format');
  return parseInt(match[1], 10);
}
```

### `backend/src/api/tickets.js` (MODIFY)

Add route before `module.exports`:
```javascript
router.get('/:ticketId/review/diff', verifyTokenOrAgent, async (req, res) => {
  try {
    const ticket = await ticketController.getTicketForReview(req.params.ticketId);
    const projectId = ticket.project_id;
    const diff = await GitHubService.getPRDiff(projectId, req.params.ticketId);
    res.json({ success: true, data: diff });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: { message: error.message } });
  }
});
```

### Add `require` at top:
```javascript
const GitHubService = require('../../services/GitHubService');
```

### `backend/src/validators/tickets.js` (MODIFY)

Update `commentSchema`:
```javascript
const commentSchema = Joi.object({
  content: Joi.string().min(1).max(5000).required(),
  file_path: Joi.string().max(512).optional(),
  line_number: Joi.number().integer().min(1).optional(),
});
```

### `frontend/src/components/DiffViewer.vue` (CREATE)

```vue
<template>
  <div class="diff-viewer">
    <div class="diff-controls">
      <label><input type="radio" v-model="viewMode" value="split"> Split</label>
      <label><input type="radio" v-model="viewMode" value="unified"> Unified</label>
      <button @click="collapseAll">Collapse All</button>
      <button @click="expandAll">Expand All</button>
    </div>
    <div v-for="file in files" :key="file.filename" class="diff-file">
      <div class="file-header" @click="file.collapsed = !file.collapsed">
        <span class="file-icon">{{ fileIcon(file.status) }}</span>
        <span class="file-name">{{ file.filename }}</span>
        <span class="file-stats">+{{ file.additions }} -{{ file.deletions }}</span>
      </div>
      <div v-show="!file.collapsed" ref="diffContainer" class="diff-content">
        <!-- diff2html renders here -->
      </div>
      <div class="file-comments" v-if="commentsByFile[file.filename]">
        <div v-for="comment in commentsByFile[file.filename]" :key="comment.id" class="comment">
          <div class="comment-header">{{ comment.author }} on line {{ comment.lineNumber }}</div>
          <div class="comment-body">{{ comment.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
```

### `frontend/src/api/review.js` (CREATE)

```typescript
import { get, post } from './client'

export function getGithubDiff(ticketId: string) {
  return get(`/api/v1/tickets/${ticketId}/review/diff`)
}

export function getComments(ticketId: string, type = 'review') {
  return get(`/api/v1/tickets/${ticketId}/comments?type=${type}`)
}

export function postComment(ticketId: string, data: { content: string; file_path?: string; line_number?: number }) {
  return post(`/api/v1/tickets/${ticketId}/comments`, data)
}

export function approve(ticketId: string) {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, { toPhase: 'human_approval', metadata: { action: 'approved' } })
}

export function requestChanges(ticketId: string, reason: string) {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, { toPhase: 'in_progress', metadata: { action: 'changes_requested', reason } })
}
```

## Test Plan

1. Manual: Create a ticket, link a GitHub PR, navigate to `/review` route
2. Verify diff renders in split and unified modes
3. Click a line number, add a comment, verify it appears inline
4. Click "Approve" — verify ticket transitions to `human_approval`
5. Click "Request Changes" — verify ticket goes back to `in_progress`

## Rollback Steps

1. Remove review diff endpoint from tickets.js
2. Remove review route from router
3. Revert comment schema changes
