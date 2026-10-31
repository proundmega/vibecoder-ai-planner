# 00_ARCHITECT_CHECKLIST.md - Merge Lifecycle and Conflict Handling (fg-36)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31 reviewer, fg-32 fixer loop
**Related code:** `HarnessTicketProcessor`, `GitHubService.createPullRequest`, `WorkspaceManager`, `PhaseService`

## Why this ticket exists

The harness opens a PR and stops. It does not handle a moving base branch, merge conflicts, CI checks, merge queues, post-merge verification or rollback. PR #99 already demonstrated how quickly a branch becomes dirty when master moves.

## Checklist

- [ ] Detect the repository default/base branch instead of hardcoding `main`
- [ ] Detect mergeable/conflict state before review and publish
- [ ] Add an update-branch/rebase path and a re-verification step
- [ ] Decide who resolves conflicts (human, fixer, dedicated integrator)
- [ ] Define CI check requirements and merge queue ordering
- [ ] Add post-merge verification and rollback/incident handling
- [ ] Add a merge audit trail and human approval gate
- [ ] Add conflict/dirty/CI-failure tests
