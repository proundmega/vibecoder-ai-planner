# 01_ARCHITECT_REQUIREMENT.md — Autonomous Coding Harness (fg-30)

**Status**: implemented (Phase 1)
**Date created**: 2026-11-01
**Author**: AI Assistant
**Scope**: Agent (Java) + optional backend provisioning
**Priority**: P1
**Effort**: Large

---

## Requirement

Give the Java agent an optional OpenCode-driven execution mode that can implement a
ticket end-to-end in a cloned workspace while the supervisor keeps ownership of
verification and publishing.

`HARNESS_MODE=legacy` remains the default. `HARNESS_MODE=opencode` enables the
harness. The feature is Phase 1 of fg-30: blocking prompt mode, no human question
loop and no autonomous merging.

## Threat model

The cloned workspace and everything in it is **hostile**:

- The agent can create or modify any file, including `.git/config`, hooks,
  `.gitattributes`, `opencode.json`, `.opencode/` plugins, package scripts and
  test scripts.
- The agent runs with whatever provider credentials the harness needs, but must
  not receive supervisor credentials (GitHub PAT, agent API key, database URL,
  cloud keys).
- A malicious repository may already contain symlinks, binary files, nested
  `.env` files, CI configuration or hooks before the agent touches it.
- Verification commands come from the repository and therefore execute hostile
  code; they must run with a sanitized environment.

## Acceptance criteria

1. Supervisor only publishes changes after closing the harness, staging the
   index, inspecting every real changed file, and passing the publishing guard.
2. `git status --porcelain -z -uall` is used so untracked directories cannot
   collapse into one entry and bypass protected-path checks.
3. Protected defaults include nested `.env` files, `Jenkinsfile`, `.github/**`
   and `**/secrets/**`, with configurable globs.
4. Verification, install and git children receive an allowlisted environment.
5. Workspace cleanup never follows symlinks or deletes outside
   `REPO_CLONE_DIR`.
6. Publishing restores a trusted `.git/config`, disables hooks/fsmonitor and
   works against an existing remote branch.
7. OpenCode project config cannot override the hardened temporary config.
8. Failed tickets use exponential backoff instead of re-running every poll.
9. Guard limits, retries and harness behaviour are documented and configurable.
10. Regression tests cover every security fix above.

## Out of scope

- Human question/approval loop.
- Autonomous merge or deploy.
- Multiple concurrent sessions per ticket.
- Egress firewalling inside the agent container.
- Full S3/object-store workspace isolation.

## Pending Scope Items to Present to User

Deferred improvements inherited from prior tickets' "Out of Scope" sections:

- Account lockout and API-key rotation/expiry (bp-71/bp-74 leftovers).
- Prometheus metrics for harness duration, guard rejections and retry counts.
- Log aggregation of harness events (bp-106 can consume them).
- S3-backed workspace storage instead of the local `REPO_CLONE_DIR`.
- Cypress/component and end-to-end coverage of the agent UI surfaces.
- Migration dry-run and env-var documentation generator.
