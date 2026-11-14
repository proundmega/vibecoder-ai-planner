# 01_ARCHITECT_REQUIREMENT.md - GitHub App Credentials and Least Privilege (fg-35)

**Related code:** `WorkspaceManager`, `GitHubService`, backend credential storage

## Problem

The agent authenticates to GitHub with a Personal Access Token:

- the token is long-lived and manually rotated;
- it is typically scoped to the user, not a single repository;
- it can read/write every repo the user can access;
- it lives in memory/environment with broad user scope; fg-30's askpass/header handling keeps it out of process args, but a long-lived token still has a large blast radius if leaked;
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
- **FR2 - Installation mapping:** each project/repo maps to a GitHub App installation id and a repo allowlist in `project_github_installations`; `GITHUB_APP_INSTALLATION_ID` is a single-tenant/dev fallback only.
- **FR3 - Token minting:** backend mints `POST /app/installations/{id}/access_tokens` with `repositories` and `permissions`, caches by installation+repo until near expiry.
- **FR4 - Delivery:** the agent receives a token or a short-lived proxy credential; it must not write it to disk or expose it to the sandbox.
- **FR5 - Git usage:** clone/push uses an ephemeral auth mechanism (credential helper, `http.extraHeader`, or a local proxy), never a persisted remote URL.
- **FR6 - PR operations:** PR creation/review uses the same scoped token or a backend proxy.
- **FR7 - Rotation/revocation:** app private key rotation, installation token revocation, immediate disable per project.
- **FR8 - Audit:** log installation, repo, permissions, issue time, expiry and operation; never log the token.
- **FR9 - Fallback:** `GITHUB_AUTH_MODE=app|pat`, with `pat` allowed only when `ALLOW_PAT=true`.
- **FR10 - Failure:** expired/revoked token fails closed with a clear error; never silently use a broader credential.

## Non-functional requirements

- **NFR1 - Secret containment:** the installation token must never be written to the workspace, `.git/config`, a persisted remote URL, process arguments, logs, error messages, ticket messages or the model prompt. The existing transient `GIT_ASKPASS` flow remains the delivery mechanism.
- **NFR2 - Fail closed:** a missing App configuration, missing/disabled installation, repo mismatch, expired/revoked token or unknown `GITHUB_AUTH_MODE` must stop publishing with a clear error. The agent must never widen scope or fall back to an ambient credential in `app` mode.
- **NFR3 - Deterministic verification:** every requirement has a fake-GitHub/fake-backend test; no live GitHub call is needed for the regression suite.
- **NFR4 - Operational clarity:** App registration permissions, installation mapping, rotation, revocation, PAT fallback and rollback are documented in a runbook.

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence |
|---|---|---|---|
| A1 | One GitHub App with a per-project installation mapping is enough for the current single-tenant deployment. | Multi-tenant or per-tenant Apps need a new credential-owner model. | Decision 2026-11-14; `project_github_installations` keyed by project. |
| A2 | The agent can request a token with its existing `X-API-Key`, and the project owner owns the agent. | Token delivery needs a different auth mechanism. | `POST /github/:projectId/token` uses `verifyTokenOrAgent` plus owner check; tests cover owner mismatch. |
| A3 | GitHub installation tokens are valid for at most one hour; `GITHUB_TOKEN_TTL_SECONDS` can only shorten the client-side cache, not the server expiry. | A longer TTL would require a different GitHub auth model. | The service caps `expiresAt` at the configured TTL and refreshes five minutes early. |
| A4 | The stored PAT remains only for explicit local/dev fallback and for the existing connect/validation flow. | Removing it entirely would block repo connection until an App installation UI exists. | `GITHUB_AUTH_MODE=pat` + `ALLOW_PAT=true` gated on both backend and agent; App mode never returns the stored PAT. |
| A5 | A project's connected repo in `project_repos` is authoritative for token scope. | A per-run repo override needs a different mapping. | Token requests may name a repo only if it matches the connected repo; allowlist checked. |
| A6 | GitHub's App JWT (RS256, 10-minute) exchange endpoint is reachable from the backend. | Air-gapped/GHES deployments need an API base override. | API base is the public GitHub endpoint today; GHES is a documented non-goal in `02`. |

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| Database | New `project_github_installations` table with a rollback. | `049_project_github_installations.sql` |
| Backend API | New token endpoint and installation mapping/status/disable routes; `GET /repo/agent` stops returning a PAT in App mode. | `api/github.js`, `githubController.js` |
| Backend services | New `GitHubAppAuthService` mints, caches and revokes tokens; backend PR/branch operations use the same scoped credential. | `GitHubAppAuthService.js`, `GitHubService.js` |
| Agent | Requests a short-lived token, refreshes before expiry, and feeds it to git/PR calls through a token source; no disk persistence. | `GitHubTokenProvider`, `WorkspaceManager`, `GitHubService`, `AgentApp` |
| Config | `GITHUB_AUTH_MODE`, `ALLOW_PAT`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_TOKEN_TTL_SECONDS`. | env docs and runbook |
| Security | Token scope and TTL shrink; cross-project cache isolation; fail-closed mode. | tests and `02` |
| Rollback | Set `GITHUB_AUTH_MODE=pat` + `ALLOW_PAT=true`, or disable the App routes; the mapping table can be dropped after reverting the code. | runbook |

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
- Review approval identity: fg-31 Phase 1 posts COMMENT-only reviews, and the publishing identity cannot approve its own PR. `APPROVE`/`REQUEST_CHANGES` require a separate reviewer App/identity in Phase 2.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
