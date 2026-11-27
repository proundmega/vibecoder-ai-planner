---
id: "fg-57"
title: "Git Provider Abstraction and Self-Hosted Git Support"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-11-22"
updated: "2026-11-25"
pr: null
branch: null
depends_on: ["fg-35", "fg-54"]
---

# 00 — Git Provider Abstraction and Self-Hosted Git Support (fg-57)

> **Owns:** status, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), file operations (`04`), operational procedure (`05`).

**Related code:** `backend/src/services/GitHubService.js`,
`backend/src/services/GitHubAppAuthService.js`, `backend/src/api/github.js`,
`backend/src/migrations/*project_repos*`,
`agent/src/main/java/com/vibecode/agent/service/GitHubService.java`,
`agent/src/main/java/com/vibecode/agent/service/GitHubTokenProvider.java`,
`agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`,
`backend/src/services/HarnessRunService.js`.

## Why this ticket exists

The harness can only publish to GitHub. The repository model, API routes,
credential lookup, agent service and PR creation all assume GitHub:

- `project_repos` is written with `provider = 'github'`.
- `GitHubAppAuthService` hardcodes `api.github.com` and
  `project_github_installations`.
- The backend exposes `/api/v1/github/:projectId/...` only.
- The agent has `GitHubService`, `GitHubTokenProvider`, `GITHUB_AUTH_MODE` and
  `githubToken` wired through the harness and publishing path.
- `HarnessRunService.reconcileRun()` adopts a run through `pr_url`.

That blocks private repositories that cannot be hosted on a foreign service.
The migration project in the intake (Next 14 → 16 + Strapi → Directus) is one
such repository: the source is private even though the website is public.

**First provider:** Forgejo/Gitea. It is self-hosted, lightweight and exposes a
simple pull-request API. **Second provider:** GitLab self-hosted, because it is
useful where the organisation already runs it, but it is resource-heavy and
should not be the first implementation.

**Local bare repository/SSH** is the fallback that unblocks a private repo with
the least infrastructure: the agent pushes a branch and the human reviews it
outside a PR UI.

## Readiness

- fg-35 (GitHub App credentials) and fg-54 (node/runtime fleet) are merged.
- The current GitHub path is working and must remain backward compatible.
- `project_repos` already has a `provider` column, but it is not honoured.
- No self-hosted Git server is required to plan; Forgejo can run in a
  disposable container for integration tests.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan recorded | This suite | ☑ |
| Plan merged | PR #206 | ☑ |
| Implementation | post-pilot | ☐ |
| Verification results | n/a — planned | ☐ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`05` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | GitLab self-hosted as a first-class provider (MR API, project access tokens) | self | Integration | fg-57 slice 3 | open |
| D2 | GitHub Enterprise Server support through a configurable API base URL | self | Integration | follow-up | open |
| D3 | Local bare repository/SSH publishing as the no-PR fallback | self | Integration | fg-57 slice 1 | open |
| D4 | Forgejo Actions/Gitea Actions CI trigger after push | self | CI | follow-up | open |
| D5 | Signed commits and verified branch provenance | self | Security | follow-up | open |
| D6 | Repository mirroring/sync between GitHub and a self-hosted primary | self | Operations | follow-up | open |
| D7 | Per-provider rate limiting, retries and circuit breakers | self | Reliability | fg-57 | open |
| D8 | Provider picker, connection status and MR/PR links in the UI | self | UX | fg-57 | open |
| D9 | Enforce local/self-hosted model providers for private code (Git residency is not model residency) | fg-42 | Privacy | fg-42 / follow-up | open |
| D10 | Webhook-driven review state and merge events | self | Integration | follow-up | open |
| D11 | Consolidate the private-host checks in `providers/generic`, `ProviderRegistryService` and `providers/git` | review | Security | follow-up | open |
| D12 | Pin or revalidate the resolved base URL address at connect time (DNS rebinding) | review | Security | fg-57b / follow-up | open |
| D13 | Local filesystem repo paths with a configured repository root; local repo/default-branch existence validation and the 04 integration test | review | Security | fg-57d2 | open |
| D14 | Forgejo/Gitea `getFileContent` for repo-profile detection (returns null in fg-57e) | review | Functionality | fg-57f / follow-up | open |
| D15 | Paginate Forgejo/Gitea branch and review listings beyond the first 50 items | review | Reliability | follow-up | open |
| D16 | Pass the allowed provider origin into the agent `WorkspaceManager` so HTTPS token auth is scoped to the connected provider | review | Security | fg-57d2 / follow-up | open |
| D17 | Agent provider-neutral repo credential for clone/push and the `/git/:projectId/token` route | self | Functionality | fg-57f2 | open |
| D18 | Project settings provider picker and connection status UI; regenerate the tracked `openapi-generated.json` (`npm run generate:spec`) before frontend codegen | self | UX | fg-57f3 / follow-up | open |
| D19 | Agent backend-proxied Forgejo/Gitea review client (agent-side PR creation) | self | Functionality | fg-57f2b | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | First provider | Forgejo/Gitea / GitLab / local bare only | Forgejo/Gitea: lightweight, self-hosted, PR UI | Answered 2026-11-22: Forgejo/Gitea first; GitLab is resource-heavy |
| 2 | Local bare repository/SSH in the first slice | include / defer | Include as the fallback; it unblocks private repos without a server | Pending |
| 3 | GitLab scope | same suite later / separate follow-up | Same suite, slice 3, deferred until Forgejo works | Answered 2026-11-22: later slice; do not make it the first dependency |
| 4 | Credentials | PAT/project token first / OAuth first / deploy key only | Token first; SSH deploy key for local bare repos | Pending |
| 5 | Test server | disposable Forgejo container / existing host | Disposable container in integration tests; never production | Pending |

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] `03` matrix is green and `03` Results is dated
- [ ] GitHub remains backward compatible
- [ ] A real private repository can be connected, run and reviewed without GitHub
- [ ] The deferred register reflects what was actually left out
- [ ] No production repository or credential is used
