# 03_ARCHITECT_IMPLEMENTATION.md — Autonomous Coding Harness (fg-30)

**Status**: implemented (Phase 1)
**Date created**: 2026-11-01
**Author**: AI Assistant

---

## Implementation actions

### Agent

1. `EnvironmentSanitizer` — shared allowlist for OpenCode, verification and git.
2. `WorkspaceManager`
   - `git status --porcelain -z -uall`, NUL parsing, rename handling.
   - Binary-safe, bounded line counting and byte totals.
   - `stageAll()` and `commitAndPushStaged()`.
   - Trusted `.git/config` snapshot/restore, hooks/fsmonitor disabled.
   - `ls-remote` + explicit `--force-with-lease` for URL pushes.
   - Symlink-safe cleanup bounded by `REPO_CLONE_DIR`.
   - Path-traversal check when writing legacy file operations.
3. `PublishingGuard` — nested `.env`, `Jenkinsfile`, `.github/**`, byte limit,
   env-configurable limits.
4. `VerificationRunner` — allowlisted env, bounded tail output, bounded install
   commands before verification.
5. `HarnessTicketProcessor`
   - fail closed when no verification commands exist.
   - dependency install before verification.
   - close harness immediately after prompt; stage before guard.
   - per-ticket deadline, exponential failure backoff.
   - best-effort post-publish ticket bookkeeping.
6. `OpenCodeClient`
   - `OPENCODE_DISABLE_PROJECT_CONFIG=true`.
   - separate short-timeout control client and long prompt client.
   - project config cannot override generated config.
7. `OpenCodeConfigWriter`
   - `doom_loop` deny, `.git/**`/`.opencode/**` edit deny.
   - provider/model normalization and override validation.
   - preserve custom `baseURL` for OpenCode providers.
8. `ProviderSettings.toString()` redacts the API key.

### Backend / CI / runtime

- `PoolManager` passes `PROJECT_ID`, `REPO_OWNER`, `REPO_NAME` and all
  `HARNESS_*` variables to pool-provisioned agents.
- Agent compose memory raised to 2G and harness variables passed through.
- Jenkins builds the agent Docker image after `mvn package`.
- README, AGENTS.md and `.env.example` document the new behaviour and limits.

## Testing steps

```bash
cd agent && mvn test          # unit + regression tests
cd agent && mvn package -DskipTests
cd backend && npm test
```

Regression coverage includes:

- untracked directories containing `.github/workflows` or `.env`
- nested `.env`, `Jenkinsfile`, `.github/actions`
- binary untracked file counting
- symlink cleanup and clone-root boundary
- malicious hooks/config plus pre-existing remote branch
- verification environment leakage
- `OPENCODE_DISABLE_PROJECT_CONFIG`
- model normalization and provider-key redaction
- fail-closed verification, install failure and post-publish API failure

## Rollout

1. Keep `HARNESS_MODE=legacy` in production.
2. Build the image (`docker build -t vibecode-agent .`).
3. Canary one project with `HARNESS_MODE=opencode` and explicit
   `HARNESS_VERIFY_COMMANDS`.
4. Watch guard rejections/retries before enabling broadly.

## Rollback

Set `HARNESS_MODE=legacy` (no data migration). Guard/verification changes are
backward-compatible with the legacy path.

## Pending Scope Items to Present to User

- Approval gate before publishing high-risk paths.
- Per-phase telemetry and alerting.
- Sandbox/egress policy for verification commands.
