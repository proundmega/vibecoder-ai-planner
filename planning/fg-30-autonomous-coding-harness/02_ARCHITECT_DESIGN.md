# 02_ARCHITECT_DESIGN.md — Autonomous Coding Harness (fg-30)

**Status**: implemented (Phase 1)
**Date created**: 2026-11-01
**Author**: AI Assistant

---

## Architecture

```
AgentApp
  └── HarnessTicketProcessor (supervisor)
        ├── PlanningDocFetcher          (backend API)
        ├── WorkspaceManager            (clone, stage, guard, commit, push)
        ├── OpenCodeClient              (opencode serve, loopback + per-run password)
        ├── VerificationRunner          (install + test/lint/typecheck)
        └── PublishingGuard             (protected paths + size limits)

workspace directory = hostile
.git/config, hooks, .gitattributes, package scripts = hostile
verification/git/opencode children = allowlisted environment only
```

## Trust boundary

| Operation | Owner | Trust |
|-----------|-------|-------|
| Read/edit/test code | OpenCode harness | untrusted |
| Verification commands | supervisor executes repo scripts | untrusted child, sanitized env |
| Stage + diff | supervisor git | trusted binary, hostile repo |
| Publish/commit/push | supervisor | trusted, trusted `.git/config` |
| PR creation | supervisor | trusted |

The harness is denied `git commit/push/merge`, `question` and `doom_loop`, but
those rules are defense-in-depth. The supervisor never relies on them.

## Key decisions

### 1. Diff collection

`git status --porcelain -z -uall` is parsed as NUL-separated records. Rename/copy
records consume the following old-path token. Untracked directories are expanded
to their real files. Line counting is byte-oriented and bounded; binary files do
not throw. `DiffSummary` also carries a byte total so the guard can reject huge
binary payloads.

### 2. Stage before guard (supervisor-owned index)

The processor closes the harness and every verification process group
immediately after the blocking prompt, then builds a **fresh index** with
`GIT_INDEX_FILE` + `git read-tree HEAD` + `git add -A`. The agent-controlled
`.git/index` is never trusted: `assume-unchanged`, `skip-worktree` and
index-only cache entries are discarded.

Guard data is read from index blobs (`git diff --cached --name-status -z`,
`git ls-files -s -z`, `git cat-file`), not from `.gitattributes`-sensitive
`git diff --numstat`. Publishing writes the guarded tree with `git write-tree`,
creates the commit with `git commit-tree`, and pushes that commit SHA, so the
worktree cannot change between guard and publish. Renames are reported with
`--no-renames` so a protected old path is always visible.

### 3. Hostile git repository

At clone time the supervisor snapshots `.git/config`. Before staging/publishing
it restores that snapshot, verifies `.git` is a real directory (not a symlink),
and runs git with:

- `core.hooksPath=/dev/null`
- `core.fsmonitor=false`
- `--no-verify` on commit/push
- `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`
- an allowlisted environment

`--force-with-lease` against a URL remote is fixed by resolving the remote branch
with `git ls-remote` and passing an explicit
`--force-with-lease=refs/heads/<branch>:<sha>` expectation. A retry may overwrite
a branch that has not moved; it never silently loses a moved branch.

### 4. OpenCode configuration

The temporary config is generated outside the workspace and is made
authoritative with `OPENCODE_DISABLE_PROJECT_CONFIG=true`. Permissions deny
project config edits, `.git/**`, `.opencode/**`, web tools and `doom_loop`.
Provider/model normalization strips a leading `provider/` prefix and rejects an
override for a provider that is not defined in the temporary config.

### 4b. Process groups and credentials

OpenCode and every verification command run as a POSIX process-group leader
(`setsid`). The supervisor kills the whole group after the prompt and after each
command, including commands that exit normally, so background children cannot
touch the index/config during publishing. GitHub credentials use a short-lived
`GIT_ASKPASS` script rather than a token in argv or `.git/config`; the script is
deleted immediately after clone/push. Debug logging redacts token-bearing args.

### 4c. Pool reuse

A pooled container's environment is fixed at creation. `PoolManager` records
project, normalized repository and provider signature on each entry and only
reuses an idle container when all three match.

### 5. Environments

`EnvironmentSanitizer` is an allowlist (PATH, HOME, locale, temp dirs, shell/OS
essentials). Verification adds `CI=1` and git safety variables. OpenCode adds
its isolated HOME/XDG dirs and server password. Git adds `GIT_CONFIG_*`. Secrets
such as `GITHUB_TOKEN`, `AGENT_API_KEY`, `DATABASE_URL` and `AWS_*` are never
inherited.

### 6. Failure handling

Failures release the ticket with exponential backoff:
`min(base * 2^(attempt-1), max)`, pinned at `max` after `HARNESS_MAX_ATTEMPTS`.
This prevents a 30-second poll loop from re-running a 45-minute harness. Post-push
ticket bookkeeping is best-effort so a successful push/PR is not discarded.

### 7. Workspace cleanup

Cleanup asserts the workspace is under `REPO_CLONE_DIR`, deletes symlinks
themselves, and walks without following links. `Files.walk`/`Files.list` are
always closed.

## Alternatives considered

- **Parse the OpenCode diff endpoint.** Rejected: the harness is untrusted and
  may lie about its own diff.
- **Run verification before the prompt.** Rejected: dependencies installed before
  agent edits may be stale.
- **Push via `origin` with a credential helper.** Rejected: persists a token or
  creates a long-lived helper file in the workspace.
- **Leave failed tickets `in_progress`.** Viable, but backoff is more explicit and
  keeps the existing release/retry semantics.

## Risks

- Verification scripts still execute hostile code; the mitigation is environment
  isolation, not a sandbox. A container/VM boundary is still required.
- A malicious `.gitattributes` can make git fail; this is fail-closed.
- OpenCode 2.x may change the server API; the Docker image pins 1.x.

## Pending Scope Items to Present to User

- Egress restrictions and read-only mounts for the workspace.
- Per-ticket container/VM isolation instead of a shared JVM.
- Metrics/tracing for harness phases and retries.
- Human approval loop for high-risk diffs.
