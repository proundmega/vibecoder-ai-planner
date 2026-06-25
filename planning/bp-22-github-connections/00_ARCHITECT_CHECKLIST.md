# 00_ARCHITECT_CHECKLIST.md — GitHub Connections

**Status**: completed
**Date created**: 2026-06-24

## Pre-Implementation Audit

### Existing Infrastructure Audit
- [x] GitHub API endpoints exist in `backend/src/api/github.js`:
  - `GET /:projectId/repo` — get repo status
  - `POST /:projectId/repo/connect` — connect repo
  - `DELETE /:projectId/repo` — disconnect repo
  - `GET /:projectId/branches` — list branches
  - `POST /:ticketId/branch` — create branch
  - `DELETE /:ticketId/branch` — delete branch (dead in frontend)
  - `GET /:projectId/prs` — list PRs
  - `POST /:ticketId/pr` — create PR (dead in frontend)
- [x] GitHubService has `getProjectRepos()` — dead (never called)
- [x] ProjectDetail.vue has a "GitHub" tab with repo status, branches, PRs
- [x] `deleteBranch()` and `createPR()` exist in `frontend/src/api/github.js` — dead (never imported)
- [x] Permission: `PROJECT_MANAGE_MEMBERS` for connect/disconnect

### Risk Assessment
- Medium risk — existing GitHub tab needs to be extracted into standalone page
- Existing GitHub tab in ProjectDetail.vue should show a link to the new page
- Need to handle the fact that GitHubService has dead code (`getProjectRepos()`)

### Files to Touch
**Frontend**:
1. `frontend/src/views/GitHubConnections.vue` — NEW view
2. `frontend/src/router/index.ts` — add `/projects/:id/github` route
3. `frontend/src/views/ProjectDetail.vue` — add link to GitHub Connections in GitHub tab
4. `frontend/src/api/github.js` — wire up `deleteBranch()` and `createPR()` (already exist)

**Backend**:
5. `backend/src/services/GitHubService.js` — optionally remove `getProjectRepos()` dead code (low priority)

**Tests**:
6. `frontend/src/__tests__/github.test.js` — already exists (11 tests)

### Validation Steps
- [ ] `cd frontend && npm run lint` — zero errors
- [ ] `cd frontend && npm run typecheck` — zero errors
- [ ] `cd frontend && npm test -- --run` — all pass
- [ ] `cd frontend && npm run build` — succeeds

### Rollback
Revert new files and route changes. No backend changes.

---

*Ready for requirement phase.*
