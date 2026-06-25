# 03_ARCHITECT_IMPLEMENTATION.md — GitHub Connections

**Status**: completed
**Priority**: P2 (Medium)
**Effort**: Medium (~2-3 hours)
**Author**: AI Assistant
**Date created**: 2026-06-24
**Date completed**: 2026-06-25
**PR**: TBD
**Branch**: bp-22-github-connections

## Implementation Plan

### Phase 1: Create GitHub Connections View

1. **Create `GitHubConnections.vue`** — NEW view component:
   - Fetch repo status, branches, PRs on mount
   - Repo section: show status, connect/disconnect form
   - Branches section: list branches, delete button per branch, create branch modal
   - PRs section: list PRs, create PR modal
   - Import and use `deleteBranch()` and `createPR()` (already exist in API client)
   - Follow same styling as ProjectDetail.vue GitHub tab

### Phase 2: Add Route and Navigation

2. **Add route** in `frontend/src/router/index.ts`:
   ```typescript
   { path: 'github', name: 'ProjectGitHub', component: () => import('../views/GitHubConnections.vue') }
   ```
   As a child route under `/projects/:id`

3. **Add link in ProjectDetail.vue** — in the GitHub tab content, add:
   ```vue
   <router-link :to="`/projects/${projectId}/github`">
     Manage GitHub
   </router-link>
   ```

### Phase 3: Verify

4. `cd frontend && npm run lint` — zero errors
5. `cd frontend && npm run typecheck` — zero errors
6. `cd frontend && npm test -- --run` — all pass
7. `cd frontend && npm run build` — succeeds

## Rollback Plan

Remove GitHubConnections.vue, remove route, remove link in ProjectDetail.vue. No backend changes.

---

*Ready for implementation.*
