# 00_ARCHITECT_CHECKLIST.md — Autonomous Coding Harness (fg-30)

**Status**: completed (Phase 1)
**Date started**: 2026-11-01
**Date completed**: 2026-11-01
**Author**: AI Assistant
**Feature scope**: Agent + backend provisioning

---

## Pre-Implementation Checklist

- [x] Read `01_ARCHITECT_REQUIREMENT.md`
- [x] Read `02_ARCHITECT_DESIGN.md`
- [x] Read `03_ARCHITECT_IMPLEMENTATION.md`
- [x] Read `04_SPECIFICATION.md`
- [x] Threat model treats the cloned workspace as hostile
- [x] Scope and out-of-scope items are documented

## Existing Infrastructure Audit

- [x] Java agent exists (`agent/`)
- [x] Legacy `TicketProcessor`/`WorkspaceManager` exist
- [x] Backend provider and repository configuration exists
- [x] Pool provisioning exists (`PoolManager`)
- [x] Docker/Jenkins build paths exist

## Dependency Analysis

- [x] `okhttp-sse` added for event streaming
- [x] No new backend dependency
- [x] OpenCode version pinned in the agent Docker image

## Configuration Audit

- [x] Harness env vars documented in README, AGENTS.md and `.env.example`
- [x] Default mode remains `legacy`
- [x] Backward-compatible `commitAndPush` retained

## Testing Strategy

- [x] Regression tests for untracked directories and protected paths
- [x] Regression tests for symlink cleanup and clone-root boundary
- [x] Regression tests for hostile git hooks/config and existing remote branch
- [x] Regression tests for environment sanitization
- [x] Regression tests for project-config disabling, model normalization and key redaction
- [x] Regression tests for fail-closed verification, install failure and retry backoff
- [x] Regression tests for supervisor index blobs, assume-unchanged,
      skip-worktree, `.gitattributes -diff`, protected renames and post-guard
      worktree changes
- [x] Regression tests for background descendants, credential redaction and
      pool reuse mismatches
- [x] `mvn test` (124 tests) and `mvn package -DskipTests` pass
- [x] Backend Jest suite passes (1347 tests)

## Deployment

- [x] Compose memory raised for Node/Vitest
- [x] Pool agents receive `PROJECT_ID`, `REPO_*` and `HARNESS_*`
- [x] Jenkins builds the agent Docker image

## Pending Scope Items to Present to User

- Egress allowlist / sandboxed verification.
- Approval gate for high-risk changes.
- Harness metrics, tracing and alerting.
