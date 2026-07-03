# bp-34: Code Review UI — GitHub PR Diff

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Medium

## Problem Statement

When a ticket reaches the `review` phase, the reviewer has no way to see what code changed. The agent creates a GitHub PR via `GitHubService.createTicketPR()`, and the `pr_url` is stored on the ticket, but the review process happens entirely outside the system. Approval is a blind status toggle. Line-level commenting, requesting changes, and approving diffs require leaving the app.

## Scope

- **In scope**: Fetch PR diff from GitHub API, render split/unified diff view, line-level commenting, "Request changes" and "Approve" actions, new UI component for diff viewing
- **Out of scope**: Webhook-based PR status sync, automated merge, local file diffs (bp-35)

## Acceptance Criteria

- [ ] Backend proxy endpoint fetches PR diff from GitHub and returns structured file list with patches
- [ ] Frontend DiffViewer.vue renders diffs in split and unified modes with syntax highlighting
- [ ] Users can click a line number to add a comment (stored in `ticket_comments` with `file_path` and `line_number`)
- [ ] "Request changes" transitions ticket back to `in_progress` with a summary comment
- [ ] "Approve" transitions ticket to `human_approval` phase
- [ ] Line comments are displayed inline on the diff, grouped by file
- [ ] Existing `ticket_comments` table is reused with new metadata fields

## Known Unknowns

- **Large diffs**: PRs with hundreds of changed files could be slow. Need pagination or truncation.
- **GitHub token scopes**: The stored access token may not have read access to PR diffs. Need to verify at connect time.
- **PR not found**: If PR is deleted or branch is gone, the endpoint should return a clear error.

## Decisions Required

1. **Where to fetch the PR diff?**
   - Option A: Backend proxies the GitHub API request (CORS-safe, token stays server-side)
   - Option B: Frontend calls GitHub API directly with a token (leaks token to client)
   - **Recommendation**: Option A — backend proxy preserves security. Frontend talks to `/api/v1/tickets/:id/review/diff`, which delegates to `GitHubService`.

2. **How to render diffs?**
   - Option A: Use `diff2html` library (battle-tested, split/unified modes, syntax highlighting)
   - Option B: Custom Vue component rendering parsed hunks
   - **Recommendation**: Option A — `diff2html` is proven. Wrap it in a Vue component with line-click event forwarding.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/tickets.js` | MODIFY | Add GET /:ticketId/review/diff endpoint |
| `backend/src/services/GitHubService.js` | MODIFY | Add getPRDiff() method |
| `backend/src/validators/tickets.js` | MODIFY | Add commentSchema with file_path, line_number fields |
| `frontend/src/views/CodeReview.vue` | CREATE | Review page with diff viewer + comments |
| `frontend/src/components/DiffViewer.vue` | CREATE | Reusable diff rendering component |
| `frontend/src/api/review.js` | CREATE | API client for review endpoints |
| `frontend/src/router/index.ts` | MODIFY | Add review route |

## Dependencies

- **Depends on this**: bp-26 (phase machine — need `review` and `human_approval` phases), bp-24 (agent creates PRs with real code)

## Performance Considerations

- Diffs are fetched from GitHub API which has rate limits (5000 req/hr for authenticated). Cache the diff per PR SHA.
- Large diffs (>100 files) should be fetched in chunks via GitHub's paginated diff API.
