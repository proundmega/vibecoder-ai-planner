---
id: "fg-35"
title: "GitHub App Credentials and Least Privilege"
status: in_review
priority: "P0"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-14"
pr: 143
branch: "feat/fg-35-github-app-credentials"
depends_on: ["fg-30"]
---

# 00 — GitHub App Credentials and Least Privilege (fg-35)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `WorkspaceManager`, `GitHubService`, backend `GitHubService`/providers, credential storage

## Why this ticket exists

Publishing currently uses a long-lived GitHub PAT. We removed it from `.git/config` and process arguments (askpass/header handling), but it still lives in memory/environment with broad access across every repo the user can see. A production coding agent should use a GitHub App installation token scoped to one repository and a short TTL.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | PR #105, follow-up consistency fix #106 | ☑ |
| Implementation started | `feat/fg-35-github-app-credentials`; backend migration, mint/cache service, token endpoint, agent token provider and tests | ☑ |
| Implementation in review | PR #143, head `957cdad`; review rounds B1-B5, R1-R2 and R3-R5 resolved | ☑ |
| Verification results | `03` → Results: backend 1638 tests, agent 540 tests (5 skipped), planning check and `git diff --check` | ☑ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | General agent key rotation follow-up | bp-74 | Security | bp-74 follow-up | open |
| D2 | Tokenless sandbox with a provider proxy | fg-34 | Security | fg-34-harness-sandbox | open |
| D3 | Merge queue permissions | fg-36 | Delivery | fg-36-merge-lifecycle | open |
| D4 | Credential audit events | fg-41 | Observability | fg-41-harness-observability | open |
| D5 | Secret scanning/redaction | fg-42 | Privacy | fg-42-harness-privacy | open |
| D6 | Bind every refreshed token from `GitHubTokenProvider.knownTokens()` into the harness redactor/leak guard. The current pattern rules cover `ghs_` tokens, but dynamic binding would make redaction independent of the format. | fg-35 | Privacy | fg-42 / follow-up | open |
