# 00_ARCHITECT_CHECKLIST.md - GitHub App Credentials and Least Privilege (fg-35)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (harness publishing)
**Related code:** `WorkspaceManager`, `GitHubService`, backend `GitHubService`/providers, credential storage

## Why this ticket exists

Publishing currently uses a long-lived GitHub PAT. We removed it from `.git/config`, but it still lives in memory/process arguments and grants broad access across every repo the user can see. A production coding agent should use a GitHub App installation token scoped to one repository and a short TTL.

## Checklist

- [ ] Create/register the GitHub App and define required permissions
- [ ] Define installation-per-project mapping and repo allowlist
- [ ] Implement token minting, caching and expiry handling
- [ ] Use the token without persisting it in the workspace or process args
- [ ] Add rotation/revocation and audit events
- [ ] Add a dev-only PAT fallback behind a flag
- [ ] Add tests for expiry, scope, leakage and multi-repo isolation
- [ ] Document GitHub Enterprise support and migration from PATs
