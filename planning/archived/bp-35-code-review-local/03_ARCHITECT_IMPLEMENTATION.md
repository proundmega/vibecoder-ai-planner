# bp-35: Code Review UI — Local File Changes — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

## Purpose
Store and render agent-generated file diffs for review, with the same UI as GitHub PR diffs.

## Implementation Order

1. **Create migration 022** — `backend/src/migrations/022_review_diffs.sql`
   - Create review_diffs table
   - *Depends on*: nothing

2. **Create ReviewService.js** — `backend/src/services/ReviewService.js`
   - saveLocalDiff, getLocalDiff, clearLocalDiff
   - *Depends on*: Step 1

3. **Create review API routes** — `backend/src/api/review.js`
   - POST and GET local-diff endpoints
   - *Depends on*: Step 2

4. **Mount review routes** — `backend/src/api/v1/index.js`
   - `router.use('/tickets', reviewRouter)`
   - *Depends on*: Step 3

5. **Add useReviewDataSource composable** — `frontend/src/composables/useReviewDataSource.ts`
   - Try GitHub PR first, fall back to local diff
   - Compute unified diff from old/new content
   - *Depends on*: nothing

6. **Update review API client** — `frontend/src/api/review.js`
   - Add getLocalDiff, postLocalDiff
   - *Depends on*: Step 3

7. **Update CodeReview.vue** — `frontend/src/views/CodeReview.vue`
   - Use useReviewDataSource instead of direct GitHub fetch
   - Show source indicator ("GitHub PR" vs "Local changes")
   - *Depends on*: Steps 5, 6

8. **Modify TicketProcessor.java** — `agent/src/.../TicketProcessor.java`
   - Upload diffs after file writes, before commit
   - *Depends on*: Step 3 (API must exist)

## Per-File Action Plan

### `backend/src/migrations/022_review_diffs.sql` (CREATE)

```sql
CREATE TABLE IF NOT EXISTS review_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    file_path VARCHAR(512) NOT NULL,
    action VARCHAR(16) NOT NULL,
    old_content TEXT,
    new_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_review_diffs_ticket ON review_diffs(ticket_id);
```

### `backend/src/migrations/022_review_diffs_rollback.sql` (CREATE)

```sql
DROP TABLE IF EXISTS review_diffs;
```

### `backend/src/services/ReviewService.js` (CREATE)

```javascript
const db = require('../db');

async function saveLocalDiff(ticketId, files) {
  for (const file of files) {
    await db.pool.query(
      `INSERT INTO review_diffs (ticket_id, file_path, action, old_content, new_content)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ticket_id, file_path) DO UPDATE
       SET action = $3, old_content = $4, new_content = $5`,
      [ticketId, file.path, file.action, file.old_content || null, file.new_content || null]
    );
  }
  return { saved: files.length };
}

async function getLocalDiff(ticketId) {
  const { rows } = await db.pool.query(
    'SELECT * FROM review_diffs WHERE ticket_id = $1 ORDER BY file_path',
    [ticketId]
  );
  return rows;
}

async function clearLocalDiff(ticketId) {
  await db.pool.query('DELETE FROM review_diffs WHERE ticket_id = $1', [ticketId]);
}

module.exports = { saveLocalDiff, getLocalDiff, clearLocalDiff };
```

### `backend/src/api/review.js` (CREATE)

```javascript
const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const ReviewService = require('../services/ReviewService');

router.post('/:ticketId/review/local-diff', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) return res.status(400).json({ success: false, error: { message: 'files must be an array' } });
    const result = await ReviewService.saveLocalDiff(req.params.ticketId, files);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/:ticketId/review/local-diff', verifyToken, async (req, res, next) => {
  try {
    const diffs = await ReviewService.getLocalDiff(req.params.ticketId);
    res.json({ success: true, data: { files: diffs } });
  } catch (err) { next(err); }
});

module.exports = router;
```

### `backend/src/api/v1/index.js` (MODIFY)

Add after ticket routes:
```javascript
const reviewRouter = require('../review');
router.use('/tickets', reviewRouter);
```

### `frontend/src/api/review.js` (MODIFY — add to existing from bp-34)

```typescript
export function getLocalDiff(ticketId: string) {
  return get(`/api/v1/tickets/${ticketId}/review/local-diff`)
}

export function postLocalDiff(ticketId: string, files: LocalDiffFile[]) {
  return post(`/api/v1/tickets/${ticketId}/review/local-diff`, { files })
}
```

### `frontend/src/composables/useReviewDataSource.ts` (CREATE)

```typescript
import { ref } from 'vue'
import { getGithubDiff, getLocalDiff } from '../api/review'
import { computePatch } from '../utils/diff'

export interface DiffFile {
  filename: string
  status: string
  patch: string
  additions: number
  deletions: number
}

export function useReviewDataSource(ticketId: string) {
  const source = ref<'github' | 'local' | null>(null)
  const files = ref<DiffFile[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const github = await getGithubDiff(ticketId)
      if (github?.files?.length > 0) {
        source.value = 'github'
        files.value = github.files
        return
      }
    } catch { /* no github PR */ }

    try {
      const local = await getLocalDiff(ticketId)
      if (local?.files?.length > 0) {
        source.value = 'local'
        files.value = local.files.map((f: any) => ({
          filename: f.file_path,
          status: f.action,
          patch: computePatch(f.old_content, f.new_content, f.file_path),
          additions: countLines(f.new_content),
          deletions: countLines(f.old_content),
        }))
        return
      }
    } catch { /* no local diff */ }

    source.value = null
    files.value = []
  }

  return { source, files, loading, error, load }
}
```

### `agent/src/.../TicketProcessor.java` (MODIFY)

In `processTicket()`, after file operations are generated and written:

```java
// Upload diffs for review
if (!fileOperations.isEmpty()) {
    try {
        List<Map<String, Object>> diffPayload = new ArrayList<>();
        for (FileOperation op : fileOperations) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("path", op.getPath());
            entry.put("action", op.getAction().name().toLowerCase());
            if (op.getAction() == FileOperation.Action.MODIFY) {
                entry.put("old_content", workspaceManager.readFileContent(op.getPath()));
            }
            entry.put("new_content", op.getContent());
            diffPayload.add(entry);
        }
        Map<String, Object> body = new HashMap<>();
        body.put("files", diffPayload);
        apiService.post("/tickets/" + ticket.getId() + "/review/local-diff", body);
        log.info("Uploaded {} file diffs for review", fileOperations.size());
    } catch (Exception e) {
        log.warn("Failed to upload diffs for review (non-fatal): {}", e.getMessage());
    }
}
```

## Test Plan

1. Run migration 022
2. POST local diffs via curl/manual API call
3. Verify stored in review_diffs table
4. GET local diffs — verify response structure
5. Frontend: verify CodeReview.vue shows local diffs when no GitHub PR
6. Frontend: verify source indicator shows "Local changes"

## Rollback Steps

1. Run rollback 022
2. Remove review.js from v1/index.js
3. Revert CodeReview.vue changes
4. Revert TicketProcessor.java changes
