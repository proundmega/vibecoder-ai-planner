# bp-24: Fix Java Agent to Write Real Code — Implementation

**Status**: planned
**Priority**: P0
**Effort**: Large
**Scope**: Agent

## Purpose
Agent actually writes code to disk, commits, and pushes instead of creating empty PRs.

## Implementation Order

1. **Create FileOperation.java** — `agent/src/.../FileOperation.java`
   - Simple POJO: path (String), content (String), action (enum: CREATE/MODIFY/DELETE)
   - Jackson-serializable (annotated with @JsonProperty)
   - *Depends on*: nothing

2. **Create WorkspaceManager.java** — `agent/src/.../WorkspaceManager.java`
   - Fields: repoDir (Path), gitBinary (String, default "git")
   - Methods: cloneRepo(url), writeFiles(List<FileOperation>), commitAndPush(message), getCommitSha()
   - Uses ProcessBuilder for git operations
   - *Depends on*: FileOperation.java

3. **Modify AgentConfig.java** — `agent/src/.../AgentConfig.java`
   - Add: String REPO_CLONE_DIR, int MAX_FILE_WRITE_RETRIES, boolean DRY_RUN
   - *Depends on*: nothing

4. **Modify GitHubService.java** — `agent/src/.../GitHubService.java`
   - Implement createCommit(): write file to repo → git add → git commit → git push
   - Actually this is now delegated to WorkspaceManager; GitHubService just handles GitHub API calls
   - *Depends on*: WorkspaceManager.java

5. **Modify TicketProcessor.java** — `agent/src/.../TicketProcessor.java`
   - Add step: fetch planning docs (GET /api/v1/tickets/:id/planning)
   - Add step: ensure repo is cloned
   - Add step: parse AI output into List<FileOperation>
   - Add step: write files via WorkspaceManager
   - Add step: commit and push
   - Add commit SHA to PR body
   - *Depends on*: Steps 1-4

## Per-File Action Plan

### `agent/src/.../FileOperation.java` (CREATE)
- Fields: path, content, action (enum CREATE/MODIFY/DELETE)
- Jackson annotations for serialization
- Static factory: `fromJson(JsonNode node)`

### `agent/src/.../WorkspaceManager.java` (CREATE)
- `void cloneRepo(String repoUrl, String branchName)` — git clone + checkout
- `void writeFiles(List<FileOperation> files)` — iterate, create dirs, write content
- `void commitAndPush(String message)` — git add -A, git commit, git push origin HEAD
- `String getCommitSha()` — git rev-parse HEAD

### `agent/src/.../AgentConfig.java` (MODIFY)
- Add after AI_MODEL:
  ```
  String REPO_CLONE_DIR = getEnv("REPO_CLONE_DIR", "/repos");
  int MAX_FILE_WRITE_RETRIES = getEnvInt("MAX_FILE_WRITE_RETRIES", 3);
  boolean DRY_RUN = getEnvBool("DRY_RUN", false);
  ```

### `agent/src/.../TicketProcessor.java` (MODIFY)
- After AI generates content, before createPR:
  ```
  1. List<FileOperation> files = parseFileOperations(aiResponse);
  2. workspaceManager.writeFiles(files);
  3. String commitSha = workspaceManager.commitAndPush(commitMessage);
  4. Include commitSha in PR body
  ```

## Migration Plan
No database changes. No API changes.

## Test Plan
Manual testing:
1. Set REPO_CLONE_DIR to a test directory
2. Set DRY_RUN=true to verify file operations without committing
3. Run agent against a test ticket
4. Verify files created in REPO_CLONE_DIR
5. Verify git log shows the commit

## Rollback Steps
1. Revert Java file changes
2. `mvn package` to rebuild
3. Redeploy agent containers
