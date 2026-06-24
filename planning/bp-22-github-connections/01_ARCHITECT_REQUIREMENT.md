# 01_ARCHITECT_REQUIREMENT.md — GitHub Connections

**Status**: planned
**Date created**: 2026-06-24

## Requirement

Create a standalone GitHub Connections page for managing GitHub repository connections, branches, and PRs. This page should be more feature-rich than the current GitHub tab in ProjectDetail.vue, including branch deletion and PR creation functionality.

## Existing Infrastructure Audit

**What exists**:
- GitHub API endpoints: connect, disconnect, list branches, list PRs, create branch, create PR, delete branch
- ProjectDetail.vue has a "GitHub" tab with repo status, branches, PRs
- `deleteBranch()` and `createPR()` exist in API client but are never imported by any component
- GitHubService has `getProjectRepos()` — dead (never called from any controller)

**What's missing**:
- No standalone GitHub Connections page
- `deleteBranch()` and `createPR()` are dead in the frontend API client
- No way to delete branches or create PRs from the UI

## Scope

**In scope**:
1. New standalone page: `/projects/:id/github`
2. Show GitHub repo connection status
3. List branches with delete button
4. List PRs with create PR button
5. Connect/disconnect repo functionality
6. Wire up `deleteBranch()` and `createPR()` API functions
7. Add link from ProjectDetail.vue GitHub tab to the new page

**Out of scope**:
- PR review/merge functionality
- Branch merge functionality
- GitHub webhook configuration
- Multi-repo support per project

## Acceptance Criteria

- [ ] New page at `/projects/:id/github` accessible from navigation
- [ ] Shows repo connection status with connect/disconnect buttons
- [ ] Lists branches with delete capability
- [ ] Lists PRs with create capability
- [ ] `deleteBranch()` and `createPR()` are wired to the API client
- [ ] ProjectDetail.vue GitHub tab has a link to the new page
- [ ] All tests pass, lint clean, build succeeds

## Testing Checklist

- [ ] Existing `github.test.js` covers all API functions (already done)
- [ ] Lint passes with zero errors
- [ ] Typecheck passes with zero errors
- [ ] All existing tests still pass
- [ ] Build succeeds

## CI Requirements (MANDATORY)

- `cd frontend && npm run lint` — zero errors
- `cd frontend && npm run typecheck` — zero errors
- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run build` — succeeds
