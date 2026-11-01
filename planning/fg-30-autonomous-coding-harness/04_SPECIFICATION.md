# 04_SPECIFICATION.md — Autonomous Coding Harness (fg-30)

**Status**: implemented (Phase 1)
**Date created**: 2026-11-01

---

## Test-First Requirement

The security fixes below were implemented with regression tests. Test classes:

- `agent/src/test/java/com/vibecode/agent/service/WorkspaceManagerTest.java`
- `agent/src/test/java/com/vibecode/agent/harness/PublishingGuardTest.java`
- `agent/src/test/java/com/vibecode/agent/harness/VerificationRunnerTest.java`
- `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java`
- `agent/src/test/java/com/vibecode/agent/harness/OpenCodeClientTest.java`
- `agent/src/test/java/com/vibecode/agent/harness/OpenCodeConfigWriterTest.java`
- `agent/src/test/java/com/vibecode/agent/harness/ProviderSettingsTest.java`
- `backend/src/__tests__/poolManager.test.js`

## Behaviour specification

### Diff and guard

- `WorkspaceManager.collectDiff()` MUST use `git status --porcelain -z -uall`.
- A new directory `.github/workflows/` with `evil.yml` MUST yield
  `ChangedFile(.github/workflows/evil.yml)`, never `.github/`.
- Binary untracked files MUST NOT throw; they contribute bytes but at most a
  bounded newline count.
- `PublishingGuard` MUST reject `.env`, `backend/.env`, `Jenkinsfile`,
  `.github/workflows/*`, `.github/actions/*`, `**/secrets/**`.
- Limits: `HARNESS_MAX_FILES` (50), `HARNESS_MAX_LINES` (2000),
  `HARNESS_MAX_BYTES` (5 MiB). Exceeding any limit rejects the publish.

### Verification

- The processor resolves install commands before verification:
  `npm ci` when a lockfile exists, otherwise `npm install`.
- If no verification commands are detected and `HARNESS_VERIFY_COMMANDS` is empty,
  the ticket fails closed and nothing is published.
- Verification children MUST NOT see `GITHUB_TOKEN`, `AGENT_API_KEY`,
  `DATABASE_URL`, `AWS_ACCESS_KEY_ID`, etc.
- Output capture is bounded to the last 8192 characters without unbounded memory.

### Publishing

- The harness is closed immediately after the blocking prompt returns, and its
  process group plus every verification process group is killed.
- The processor builds a fresh supervisor index (`GIT_INDEX_FILE` +
  `read-tree HEAD` + `add -A`), guards index blobs, then writes the tree and
  commits it with `commit-tree`. Index-only blobs, `assume-unchanged` and
  `skip-worktree` cannot affect the published tree.
- `.gitattributes: * -diff` cannot hide line counts; the guard falls back to raw
  blob lines/bytes.
- Renames are reported with `--no-renames`, so a protected old path is visible.
- Git runs with hooks/fsmonitor disabled and a trusted `.git/config` restored
  from clone time.
- GitHub credentials use a transient `GIT_ASKPASS` script, never argv or
  `.git/config`.
- Pushing to an existing branch MUST succeed using an explicit
  `--force-with-lease=refs/heads/<branch>:<sha>`.
- Post-publish `updateTicketPrUrl`/`updateTicketStatus` failures MUST NOT release
  the ticket or discard the push.

### Harness configuration

- Child OpenCode environment MUST contain
  `OPENCODE_DISABLE_PROJECT_CONFIG=true`.
- Generated permissions MUST deny `question`, `doom_loop`, web tools, `.git/**`
  and `.opencode/**` edits.
- A fully qualified model (`opencode-go/beam-free`) MUST not produce
  `opencode-go/opencode-go/beam-free`.
- A model override naming a provider different from the configured provider MUST
  fail with an actionable error.
- `ProviderSettings.toString()` MUST redact the API key.

### Retry policy

- Failures release the ticket and apply exponential backoff:
  `min(HARNESS_RETRY_BASE_DELAY_MS * 2^(attempt-1), HARNESS_RETRY_MAX_DELAY_MS)`.
- After `HARNESS_MAX_ATTEMPTS`, the delay is pinned at the maximum.
- Successful publishing clears the failure state.

### Cleanup

- Cleanup MUST delete symlinks themselves and never their targets.
- Cleanup MUST refuse paths outside `REPO_CLONE_DIR` (including the root itself).
- Directory streams/walks MUST be closed.

## Environment variables

| Name | Default |
|------|---------|
| `HARNESS_MODE` | `legacy` |
| `HARNESS_PROTECTED_PATHS` | `.env*;**/.env*;Jenkinsfile;**/Jenkinsfile;.github/**;**/.github/**;**/secrets/**` |
| `HARNESS_MAX_FILES` | `50` |
| `HARNESS_MAX_LINES` | `2000` |
| `HARNESS_MAX_BYTES` | `5242880` |
| `HARNESS_MAX_ATTEMPTS` | `3` |
| `HARNESS_RETRY_BASE_DELAY_MS` | `60000` |
| `HARNESS_RETRY_MAX_DELAY_MS` | `3600000` |

## Pending Scope Items to Present to User

- Approval workflow for protected/high-risk changes.
- Egress allowlist and sandboxed verification.
- Metrics for guard rejections and retry counts.
