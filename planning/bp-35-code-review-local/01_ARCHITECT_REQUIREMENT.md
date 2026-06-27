# bp-35: Code Review UI — Local File Changes

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Medium

## Problem Statement

Not all projects use GitHub. Projects with local repositories (or those using the pool-managed agent workspace) need code review visibility but have no PR to reference. The diff must come from the agent's workspace files rather than a remote API. The agent already generates file changes in bp-24 but discards them after commit and push — no record is kept for the review UI.

## Scope

- **In scope**: New DB table for storing diffs, agent uploads file changes post-generation, backend storage/retrieval, frontend renders using the same DiffViewer component from bp-34
- **Out of scope**: GitHub PR diffs (bp-34), interacting with GitHub API

## Acceptance Criteria

- [ ] New `review_diffs` table stores file-level changes per ticket
- [ ] Agent uploads file changes via `POST /api/v1/tickets/:id/review/local-diff` after completing code generation
- [ ] Backend returns stored diffs via `GET /api/v1/tickets/:id/review/local-diff`
- [ ] Frontend CodeReview.vue detects data source: GitHub PR first, falls back to local diffs
- [ ] Same DiffViewer.vue component renders both GitHub and local diffs
- [ ] Same line-commenting, approve, and request-changes flows work identically
- [ ] Agent integration: after `WorkspaceManager.writeFiles()`, collect the file operations and POST them

## Known Unknowns

- **Conflict with GitHub PR**: If a ticket has both a GitHub PR and local diffs, which one to show? Decision: prefer GitHub PR (it's the canonical source for remote repos).
- **Diff size**: Agent might generate large file changes. The payload could be big. Need size limits on upload.

## Decisions Required

1. **Where to store diffs?**
   - Option A: New `review_diffs` table with one row per file change per ticket
   - Option B: JSONB column on the tickets table storing all changes
   - **Recommendation**: Option A — normalized storage allows per-file queries, pagination, and future features like per-file approval.

2. **When does the agent upload?**
   - Option A: After `writeFiles()` succeeds, before `commitAndPush()`
   - Option B: After commit and push
   - **Recommendation**: Option A — if the commit fails, the diff is still available for review. The agent can retry the commit without losing diff data.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/022_review_diffs.sql` | CREATE | New table for per-file diff storage |
| `backend/src/services/ReviewService.js` | CREATE | Save and retrieve local diffs |
| `backend/src/api/review.js` | CREATE | Upload/download local diff endpoints |
| `backend/src/api/v1/index.js` | MODIFY | Mount review routes |
| `frontend/src/views/CodeReview.vue` | MODIFY | Support dual data sources |
| `agent/src/.../TicketProcessor.java` | MODIFY | Upload diffs after file writes |

## Dependencies

- **Depends on this**: bp-24 (agent must be generating file operations), bp-34 (shared DiffViewer component and review UI)

## Performance Considerations

- Diffs are stored as text in the database. Very large files (>1MB of diff text) could impact query performance. Set a max size per file (e.g., 500KB per file content, 5MB total per ticket).
- Agent upload retry: if the POST fails, the agent should retry up to 3 times before proceeding.
