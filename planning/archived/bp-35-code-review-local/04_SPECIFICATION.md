# bp-35: Code Review UI — Local File Changes — Spec

**Target model**: 14B (TypeScript + JavaScript + Java)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/022_review_diffs.sql`

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

### CREATE: `backend/src/migrations/022_review_diffs_rollback.sql`

```sql
DROP TABLE IF EXISTS review_diffs;
```

### MODIFY: `backend/src/migrations/apply.js`

Add `'022_review_diffs'` to SQL_FILES after `'017_agent_memory_fallback'` (at position 23, after line 17).

### CREATE: `backend/src/services/ReviewService.js`

```javascript
const db = require('../db');

async function saveLocalDiff(ticketId, files) {
  if (!Array.isArray(files) || files.length === 0) return { saved: 0 };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let saved = 0;
    for (const file of files) {
      const { path, action, old_content, new_content } = file;
      if (!path || !action) continue;
      await client.query(
        `INSERT INTO review_diffs (ticket_id, file_path, action, old_content, new_content)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ticket_id, file_path) DO UPDATE
         SET action = $3, old_content = COALESCE($4, review_diffs.old_content), new_content = COALESCE($5, review_diffs.new_content)`,
        [ticketId, path, action, old_content || null, new_content || null]
      );
      saved++;
    }
    await client.query('COMMIT');
    return { saved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

### CREATE: `backend/src/api/review.js`

```javascript
const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const ReviewService = require('../services/ReviewService');

router.post('/:ticketId/review/local-diff', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) {
      return res.status(400).json({ success: false, error: { message: 'files must be a non-empty array' } });
    }
    const MAX_FILES = 200;
    if (files.length > MAX_FILES) {
      return res.status(400).json({ success: false, error: { message: `Too many files (max ${MAX_FILES})` } });
    }
    const MAX_CONTENT_SIZE = 500 * 1024; // 500KB per file content
    for (const f of files) {
      if ((f.new_content && f.new_content.length > MAX_CONTENT_SIZE) ||
          (f.old_content && f.old_content.length > MAX_CONTENT_SIZE)) {
        return res.status(400).json({ success: false, error: { message: `File ${f.path} content exceeds max size` } });
      }
    }
    const result = await ReviewService.saveLocalDiff(req.params.ticketId, files);
    res.status(201).json({ success: true, data: result });
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

### MODIFY: `backend/src/api/v1/index.js`

Add after `const memoryRouter`:
```javascript
const reviewRouter = require('../review');
```

Add after `router.use('/memory', memoryRouter)`:
```javascript
router.use('/tickets', reviewRouter);
```

### MODIFY: `frontend/src/api/review.js` — add functions

```typescript
export interface LocalDiffFile {
  path: string
  action: 'create' | 'modify' | 'delete'
  old_content?: string | null
  new_content?: string | null
}

export function getLocalDiff(ticketId: string): Promise<{ files: any[] }> {
  return get(`/api/v1/tickets/${ticketId}/review/local-diff`)
}

export function postLocalDiff(ticketId: string, files: LocalDiffFile[]): Promise<any> {
  return post(`/api/v1/tickets/${ticketId}/review/local-diff`, { files })
}
```

### CREATE: `frontend/src/utils/diff.ts`

```typescript
import { diffLines, formatLines } from 'diff'

function countLines(text: string | null): number {
  if (!text) return 0
  return text.split('\n').length
}

function addPrefix(text: string, prefix: string): string {
  if (!text) return ''
  return text.split('\n').map(line => `${prefix}${line}`).join('\n')
}

export function computePatch(oldContent: string | null, newContent: string | null, filename: string): string {
  if (!oldContent && newContent) {
    const lines = newContent.split('\n')
    return `--- /dev/null\n+++ b/${filename}\n@@ -0,0 +1,${lines.length} @@\n${addPrefix(newContent, '+')}`
  }
  if (oldContent && !newContent) {
    const lines = oldContent.split('\n')
    return `--- a/${filename}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${addPrefix(oldContent, '-')}`
  }
  // Both present — use the `diff` library
  const changes = diffLines(oldContent || '', newContent || '')
  let result = `--- a/${filename}\n+++ b/${filename}\n`
  let oldLine = 1
  let newLine = 1
  for (const change of changes) {
    const count = change.count || 1
    if (change.added) {
      result += `@@ -${oldLine - 1},${count + 1} +${newLine},${count} @@\n`
      result += addPrefix(change.value, '+')
      newLine += count
    } else if (change.removed) {
      result += `@@ -${oldLine},${count} +${newLine - 1},${count + 1} @@\n`
      result += addPrefix(change.value, '-')
      oldLine += count
    } else {
      oldLine += count
      newLine += count
    }
  }
  return result
}

export { countLines }
```

### CREATE: `frontend/src/composables/useReviewDataSource.ts`

```typescript
import { ref } from 'vue'
import { getGithubDiff, getLocalDiff } from '../api/review'
import { computePatch, countLines } from '../utils/diff'

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
    } catch { /* no github PR, try local */ }

    try {
      const local = await getLocalDiff(ticketId)
      if (local?.files?.length > 0) {
        source.value = 'local'
        files.value = local.files.map((f: any) => ({
          filename: f.file_path,
          status: f.action === 'create' ? 'added' : f.action === 'delete' ? 'deleted' : 'modified',
          patch: computePatch(f.old_content, f.new_content, f.file_path),
          additions: f.action === 'delete' ? 0 : countLines(f.new_content),
          deletions: f.action === 'create' ? 0 : countLines(f.old_content),
        }))
        return
      }
    } catch { /* no diff available */ }

    source.value = null
    files.value = []
  }

  return { source, files, loading, error, load }
}
```

### MODIFY: `frontend/src/views/CodeReview.vue`

Replace the `loadDiff` + `getGithubDiff` import with `useReviewDataSource`:

```diff
- import { getGithubDiff, getComments, postComment } from '../api/review'
+ import { getComments, postComment } from '../api/review'
+ import { useReviewDataSource } from '../composables/useReviewDataSource'
```

Replace:
```diff
- const files = ref<DiffFile[]>([])
- const loading = ref(true)
- const error = ref('')
+ const { source, files, loading, error, load } = useReviewDataSource(ticketId)
```

Replace `loadDiff` function call:
```diff
- async function loadDiff() { ... }
- onMounted(() => { loadDiff(); loadComments() })
+ onMounted(() => { load(); loadComments() })
```

Add source indicator below the header:
```vue
<div class="source-indicator text-xs text-gray-500 mb-2">
  Source: <span class="font-semibold">{{ source === 'github' ? 'GitHub PR' : 'Local changes' }}</span>
</div>
```

### MODIFY: `agent/src/com/vibecode/agent/TicketProcessor.java`

**After** `workspaceManager.writeFiles(files)` and **before** `workspaceManager.commitAndPush(message)`:

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
                try {
                    String existing = workspaceManager.readFileContent(op.getPath());
                    entry.put("old_content", existing);
                } catch (IOException e) {
                    log.warn("Could not read existing content for {}: {}", op.getPath(), e.getMessage());
                }
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

**Add to WorkspaceManager.java:**
```java
public String readFileContent(String path) throws IOException {
    Path fullPath = repoDir.resolve(path);
    if (!Files.exists(fullPath)) return null;
    return Files.readString(fullPath);
}
```

## Test Expectations

```
✓ POST local-diff stores files in review_diffs table
✓ GET local-diff returns stored files with correct structure
✓ GET returns empty files array when no diffs exist
✓ Frontend shows local diffs when no GitHub PR is linked
✓ Frontend shows GitHub PR diffs when both sources exist (GitHub wins)
✓ Agent uploads diffs after file writes without blocking the main flow
✓ Agent continues even if diff upload fails (warning only)
```

## Edge Cases to Handle

1. **No files**: saveLocalDiff returns `{ saved: 0 }`, frontend shows "No files to review"
2. **File too large**: 500KB per content limit, 200 files max
3. **Agent upload failure**: wrapped in try/catch, logged as warning, does not block commit
4. **Same file uploaded twice**: ON CONFLICT DO UPDATE replaces the entry
5. **Concurrent uploads**: unlikely (one agent per ticket) but transaction ensures consistency
