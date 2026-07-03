# bp-35: Code Review UI — Local File Changes — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

The agent in bp-24 writes files to disk and commits them. The file operations (`FileOperation` list) exist in memory during `TicketProcessor.processTicket()` but are discarded after the commit. There is no persistence of what changed — the review phase can only show a blank screen (or GitHub PR if available).

## Proposed Solution

### New Database Table: review_diffs

```sql
CREATE TABLE review_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    file_path VARCHAR(512) NOT NULL,
    action VARCHAR(16) NOT NULL,  -- 'create', 'modify', 'delete'
    old_content TEXT,
    new_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_id, file_path)
);

CREATE INDEX idx_review_diffs_ticket ON review_diffs(ticket_id);
```

One row per changed file per ticket. `old_content` may be null for new files. `new_content` may be null for deleted files.

### Backend: ReviewService.js

```javascript
class ReviewService {
  async saveLocalDiff(ticketId, files) {
    // Upsert each file entry
    for (const file of files) {
      await db.pool.query(
        `INSERT INTO review_diffs (ticket_id, file_path, action, old_content, new_content)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ticket_id, file_path) DO UPDATE
         SET action = $3, old_content = $4, new_content = $5`,
        [ticketId, file.path, file.action, file.oldContent, file.newContent]
      );
    }
  }

  async getLocalDiff(ticketId) {
    const { rows } = await db.pool.query(
      'SELECT * FROM review_diffs WHERE ticket_id = $1 ORDER BY file_path',
      [ticketId]
    );
    return rows;
  }

  async clearLocalDiff(ticketId) {
    await db.pool.query('DELETE FROM review_diffs WHERE ticket_id = $1', [ticketId]);
  }
}
```

### Backend: API Endpoints

**New file: backend/src/api/review.js**
```
POST /api/v1/tickets/:ticketId/review/local-diff
  Body: { files: [{ path, action, old_content?, new_content? }] }
  Auth: verifyTokenOrAgent (agent uploads, humans view)
  → stores via ReviewService.saveLocalDiff()

GET /api/v1/tickets/:ticketId/review/local-diff
  Auth: verifyToken
  → returns { files: [{ id, file_path, action, old_content, new_content }] }
```

Created as a separate router module, mounted in `v1/index.js`.

### Frontend: Data Source Detection in CodeReview.vue

Modify `CodeReview.vue` to detect which data source to use:

```typescript
// composables/useReviewDataSource.ts
function useReviewDataSource(ticketId: Ref<string>) {
  const source = ref<'github' | 'local' | 'none'>('none')
  const files = ref<DiffFile[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      // Try GitHub PR diff first
      const githubDiff = await reviewApi.getGithubDiff(ticketId.value)
      if (githubDiff && githubDiff.files.length > 0) {
        source.value = 'github'
        files.value = githubDiff.files
        return
      }
    } catch { /* no GitHub PR */ }

    // Fall back to local diff
    const localDiff = await reviewApi.getLocalDiff(ticketId.value)
    if (localDiff && localDiff.files.length > 0) {
      source.value = 'local'
      files.value = localDiff.files.map(f => ({
        filename: f.file_path,
        status: f.action,
        patch: computePatch(f.old_content, f.new_content),
      }))
    }
  }

  return { source, files, loading, load }
}
```

The `computePatch()` helper generates a unified diff string from old/new content so the same `DiffViewer.vue` component can render it.

### Agent Integration (TicketProcessor.java)

In `TicketProcessor.processTicket()`, after `WorkspaceManager.writeFiles()` and before `commitAndPush()`:

```java
// Upload local diffs for review
List<FileOperation> fileOps = parseFileOperations(aiResponse);
List<Map<String, Object>> diffPayload = new ArrayList<>();
for (FileOperation op : fileOps) {
    Map<String, Object> entry = new HashMap<>();
    entry.put("path", op.getPath());
    entry.put("action", op.getAction().name().toLowerCase());
    if (op.getAction() == FileOperation.Action.MODIFY) {
        entry.put("old_content", readExistingContent(op.getPath()));
    }
    entry.put("new_content", op.getContent());
    diffPayload.add(entry);
}
apiService.post("/tickets/" + ticketId + "/review/local-diff", Map.of("files", diffPayload));
```

### Diff Computation for Display

When old_content and new_content are both present, compute a unified diff on the fly:

```typescript
function computePatch(oldContent: string | null, newContent: string | null): string {
  if (!oldContent) return `--- /dev/null\n+++ b/${filename}\n@@ -0,0 +1,${lineCount} @@\n${addPlusPrefix(newContent)}`
  if (!newContent) return `--- a/${filename}\n+++ /dev/null\n@@ -1,${lineCount} +0,0 @@\n${addMinusPrefix(oldContent)}`
  // Both present: use a JS diff library like 'diff'
  const changes = Diff.diffLines(oldContent, newContent)
  return formatAsUnified(changes, filename)
}
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/022_review_diffs.sql` | CREATE | review_diffs table |
| `backend/src/migrations/022_review_diffs_rollback.sql` | CREATE | DROP TABLE review_diffs |
| `backend/src/services/ReviewService.js` | CREATE | save, get, clear methods |
| `backend/src/api/review.js` | CREATE | POST/GET local-diff endpoints |
| `backend/src/api/v1/index.js` | MODIFY | Mount review routes |
| `backend/src/migrations/apply.js` | MODIFY | Add 022 to SQL_FILES |
| `frontend/src/views/CodeReview.vue` | MODIFY | Add data source detection |
| `frontend/src/api/review.js` | MODIFY | Add getLocalDiff, postLocalDiff |
| `frontend/src/composables/useReviewDataSource.ts` | CREATE | Diff source detection logic |
| `agent/src/.../TicketProcessor.java` | MODIFY | Upload diffs after file writes |
| `agent/src/.../ApiService.java` | MODIFY | Add post() method if not present |
