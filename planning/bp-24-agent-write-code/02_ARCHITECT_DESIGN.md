# bp-24: Fix Java Agent to Write Real Code — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Agent

## Current State

The agent pipeline in `TicketProcessor.java`:
```
pickup → generateContent (AI) → createBranch → postMessage → createPR → updateStatus
                                  ↓
                           createCommit() = STUB
```

`GitHubService.java` has:
- `createBranch(String repoUrl, String branchName)` — works, creates branch via GitHub API
- `createPR(String repoUrl, String branchName, String title, String body)` — works, opens PR
- `createCommit(String repoUrl, String branchName, String message, String content, String filePath)` — **stub**: does nothing, returns null

The agent never clones the repo. AI-generated text is never written to disk. PRs are opened with empty branches.

## Proposed Solution

### New Workflow in TicketProcessor

```
pickup ticket
  → fetch planning docs (GET /tickets/:id/planning)
  → clone repo if not exist (REPO_CLONE_DIR/{project})
  → generate AI content with structured JSON prompt
  → parse AI output → list of FileOperation { path, content, action }
  → write/modify/delete files on disk
  → git add → git commit → git push
  → create or update PR with commit SHA
  → post message with file summary
  → update ticket status to review
```

### AgentConfig Changes

```java
// New config options
String REPO_CLONE_DIR = getEnv("REPO_CLONE_DIR", "/repos"); // Docker volume mount
int MAX_FILE_WRITE_RETRIES = getEnvInt("MAX_FILE_WRITE_RETRIES", 3);
boolean DRY_RUN = getEnvBool("DRY_RUN", false); // if true, print file ops without writing
```

### AI Prompt Enhancement

The system prompt sent to the AI model must include:
1. Ticket description + planning docs (fetched from API)
2. Current repo structure (list of files)
3. Coding conventions (from AGENTS.md or project config)
4. Output format instruction: **return JSON** with this exact schema:

```json
{
  "commit_message": "feat: implement ticket planning phase gate",
  "files": [
    {
      "path": "backend/src/services/PhaseService.java",
      "content": "package com.vibecode.service; ...",
      "action": "create"
    },
    {
      "path": "backend/src/services/TicketService.java",
      "content": "...",
      "action": "modify",
      "search": "// INSERT PHASE TRANSITION HERE"
    }
  ]
}
```

### File Operations Handler (new class: WorkspaceManager.java)

```java
class WorkspaceManager {
    Path repoDir;

    void cloneRepo(String repoUrl) { ... }
    void ensureBranch(String branchName) { ... }
    void writeFiles(List<FileOperation> files) { ... }
    void commitAndPush(String message) { ... }
    String getCommitSha() { ... }
}
```

### Error Handling Strategy

| Error | Handling |
|-------|----------|
| Clone fails (network, auth) | Release ticket, log error "Failed to clone repo" |
| AI output not valid JSON | Retry once with stricter prompt, then fail |
| File write fails (permissions, disk full) | Release ticket, log disk error |
| Commit fails (merge conflict) | Release ticket, log "Branch has conflicts" |
| Push fails (auth expired) | Release ticket, log "Git credentials expired" |

### Alternatives Considered

- **Option B: Agent runs git commands via shell** — Rejected because it's fragile and platform-dependent. Using JGit library would be cleaner, but the agent already has OkHttp for API calls; we can use ProcessBuilder for git commands which is simpler and battle-tested.
- **Option C: AI returns diff/patch format** — Rejected because patch application is error-prone; full file content is more reliable.

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `agent/src/.../AgentConfig.java` | MODIFY | Add REPO_CLONE_DIR, DRY_RUN, MAX_FILE_WRITE_RETRIES |
| `agent/src/.../TicketProcessor.java` | MODIFY | Add clone step, planning fetch, file write phase, commit step |
| `agent/src/.../GitHubService.java` | MODIFY | Implement createCommit(), add createBranch() with remote |
| `agent/src/.../WorkspaceManager.java` | CREATE | Clone, write files, git operations |
| `agent/src/.../FileOperation.java` | CREATE | Data class for {path, content, action} |
