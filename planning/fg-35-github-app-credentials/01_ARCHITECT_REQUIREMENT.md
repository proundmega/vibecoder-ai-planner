# 01_ARCHITECT_REQUIREMENT.md - GitHub App Credentials and Least Privilege (fg-35)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (harness publishing)
**Related code:** `WorkspaceManager`, `GitHubService`, backend credential storage

## Problem

The agent authenticates to GitHub with a Personal Access Token:

- the token is long-lived and manually rotated;
- it is typically scoped to the user, not a single repository;
- it can read/write every repo the user can access;
- it appears in process arguments and potentially logs;
- it is used for clone, push and PR creation by the same identity.

Scrubbing `.git/config` (fg-30) was necessary but not sufficient. A compromised harness, a malicious test, or a log leak still exposes a powerful credential.

## Goals

1. Replace PATs with GitHub App installation tokens.
2. Scope each token to one repository and the minimum permissions.
3. Use short TTLs (about one hour) and mint per run.
4. Keep the token out of the workspace, process arguments, logs and model context.
5. Make rotation and revocation operationally simple.
6. Support multiple projects/installations without cross-tenant leakage.
7. Keep a clearly labeled PAT fallback for local development only.

## Non-goals

- Replacing agent API keys (`bp-74` covered those).
- GitHub Enterprise Server in the first iteration (design for it, implement later).
- Per-user GitHub identity for reviews.

## Functional requirements

- **FR1 - App registration:** document required permissions: `contents:write`, `pull_requests:write`, `checks:read`, `metadata:read`; no admin.
- **FR2 - Installation mapping:** each project/repo maps to a GitHub App installation id and a repo allowlist.
- **FR3 - Token minting:** backend mints `POST /app/installations/{id}/access_tokens` with `repositories` and `permissions`, caches by installation+repo until near expiry.
- **FR4 - Delivery:** the agent receives a token or a short-lived proxy credential; it must not write it to disk or expose it to the sandbox.
- **FR5 - Git usage:** clone/push uses an ephemeral auth mechanism (credential helper, `http.extraHeader`, or a local proxy), never a persisted remote URL.
- **FR6 - PR operations:** PR creation/review uses the same scoped token or a backend proxy.
- **FR7 - Rotation/revocation:** app private key rotation, installation token revocation, immediate disable per project.
- **FR8 - Audit:** log installation, repo, permissions, issue time, expiry and operation; never log the token.
- **FR9 - Fallback:** `GITHUB_AUTH_MODE=app|pat`, with `pat` allowed only when `ALLOW_PAT=true`.
- **FR10 - Failure:** expired/revoked token fails closed with a clear error; never silently use a broader credential.

## Safety requirements

- A token for project A must not work for project B.
- The sandbox must not see the token.
- Token values must be redacted in all logs, errors and messages.
- The app private key lives in a secret store, not in the repo or environment files.
- Publishing must fail closed if the token cannot be minted.

## Acceptance criteria

1. Clone, push and PR creation work with a GitHub App installation token.
2. The token is scoped to the target repo and expires within the configured TTL.
3. A token from project A is rejected for project B.
4. No token appears in `.git/config`, process args, logs or model context.
5. Revoking the installation immediately blocks publishing.
6. PAT fallback is opt-in and warns.
7. Tests cover expiry, scope, revocation, leakage and multi-repo isolation.

## Out of scope

- GitHub Enterprise Server implementation.
- OAuth user login flows.
- Fine-grained PAT migration tooling.
- Review approval identity (fg-31 uses the publishing identity in Phase 1).

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-34 | Tokenless sandbox with a provider proxy | Security | `fg-34-harness-sandbox` | No |
| 2 | fg-41 | Credential audit events | Observability | `fg-41-harness-observability` | No |
| 3 | fg-42 | Secret scanning/redaction | Privacy | `fg-42-harness-privacy` | No |
| 4 | bp-74 | General agent key rotation follow-up | Security | `bp-74` follow-up | No |
