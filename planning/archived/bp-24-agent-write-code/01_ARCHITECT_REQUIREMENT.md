# bp-24: Fix Java Agent to Write Real Code

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Agent
**Priority**: P0
**Effort**: Large

## Problem Statement

The Java agent's pipeline (`TicketProcessor.java`) creates an empty branch and opens a PR with zero code. `GitHubService.createCommit()` is a stub — AI generates text but it's never written to disk or committed. The agent is effectively useless: it creates PR shells that contain no code changes.

## Scope

- **In scope**: Clone repo on ticket pickup, parse AI output into file operations, write files to disk, stage/commit/push, update PR with commit SHA
- **Out of scope**: Container orchestration (handled in bp-29), feedback loop (bp-28), web terminal (separate)

## Acceptance Criteria

- [ ] Agent clones repo to `REPO_CLONE_DIR` on ticket pickup if not already cloned
- [ ] Agent fetches planning docs from API before generating code
- [ ] AI output is parsed as structured file operations (`files: [{path, content, action}]`)
- [ ] Files are written/created/deleted on disk in the cloned repo according to AI output
- [ ] Changes are staged, committed with descriptive message, and pushed to feature branch
- [ ] Commit SHA is added to the PR body
- [ ] On failure, agent logs the error and releases the ticket with details

## Known Unknowns

- **Repo size**: Cloning a large repo could take minutes. Timeout strategy needed.
- **Merge conflicts**: If the branch already exists with conflicting changes. Currently not handled — agent opens new branch each time.
- **Binary files**: AI might try to generate binary content. We should skip non-text files or handle encoding.

## Decisions Required

1. **How to parse AI output into file operations?**
   - Option A: Structured JSON output from AI (model returns `{"files": [{"path": "...", "content": "...", "action": "create"}]}`)
   - Option B: Parse markdown code blocks from AI text output (fragile, regex-dependent)
   - **Recommendation**: Option A — instruct the AI model to return JSON. More reliable.

2. **Where to store repo clones?**
   - Option A: Docker volume mounted at configurable `REPO_CLONE_DIR`
   - Option B: Per-agent temp directory
   - **Recommendation**: Option A — persistent volume avoids re-cloning across agent restarts

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `agent/src/.../GitHubService.java` | MODIFY | Implement createCommit(), add writeFiles(), add cloneRepo() |
| `agent/src/.../AgentConfig.java` | MODIFY | Add REPO_CLONE_DIR, MAX_FILE_WRITE_RETRIES env vars |
| `agent/src/.../TicketProcessor.java` | MODIFY | Add repo clone step, file write step, AI output parsing |
| `agent/` | NO CHANGE | No new dependencies needed |

## Dependencies

- **Depends on this**: bp-25 (AI_ENDPOINT_URL) — optional, agent can use built-in Claude/OpenAI

## Performance Considerations

- Repo clone is a one-time cost per project per agent
- File writes are local disk I/O — negligible performance impact
- Commit+push latency depends on repo size and network
