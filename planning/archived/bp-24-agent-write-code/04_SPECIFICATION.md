# bp-24: Fix Java Agent to Write Real Code — Spec

**Target model**: 14B–34B (Java code generation)
**Date**: 2026-06-27

## File Operations

### CREATE: `agent/src/com/vibecode/agent/FileOperation.java`

**Imports**:
```java
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
```

**Fields**:
```
path: String        — relative path inside repo, e.g. "backend/src/services/FooService.java"
content: String     — full file content to write
action: Action      — enum: CREATE, MODIFY, DELETE
```

**Functions**:
```java
public enum Action { CREATE, MODIFY, DELETE }
public static FileOperation fromJson(JsonNode node)
  - reads path, content, action from node
  - throws if path or content is null (action defaults to CREATE)
```

### CREATE: `agent/src/com/vibecode/agent/WorkspaceManager.java`

**Imports**:
```java
import java.io.*;
import java.nio.file.*;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
```

**Fields**:
```
repoDir: Path
log: Logger
```

**Constructor**: `WorkspaceManager(String repoDir)` → sets `this.repoDir = Paths.get(repoDir)`

**Methods** (exact signatures):
```java
public void cloneRepo(String repoUrl, String branchName)
  1. Path targetDir = repoDir.resolve(extractRepoName(repoUrl))
  2. if (Files.exists(targetDir) && Files.exists(targetDir.resolve(".git"))) return  // already cloned
  3. log.info("Cloning {} to {}", repoUrl, targetDir)
  4. runGit("clone", repoUrl, targetDir.toString())
  5. runGit("-C", targetDir.toString(), "checkout", "-b", branchName)

public void writeFiles(List<FileOperation> files)
  1. for each file in files:
  2.   Path fullPath = repoDir.resolve(file.path)
  3.   if file.action == DELETE: Files.deleteIfExists(fullPath); continue
  4.   Files.createDirectories(fullPath.getParent())
  5.   Files.writeString(fullPath, file.content)

public String commitAndPush(String message)
  1. runGit("-C", repoDir.toString(), "add", "-A")
  2. runGit("-C", repoDir.toString(), "commit", "-m", message)
  3. runGit("-C", repoDir.toString(), "push", "origin", "HEAD")
  4. return getCommitSha()

public String getCommitSha()
  1. return runGit("-C", repoDir.toString(), "rev-parse", "HEAD").trim()

// private
private String runGit(String... args)
  1. ProcessBuilder pb = new ProcessBuilder(args)
  2. pb.redirectErrorStream(true)
  3. Process p = pb.start()
  4. read stdout into string
  5. int exit = p.waitFor()
  6. if exit != 0: throw RuntimeException("git failed: " + output)
  7. return output
```

### MODIFY: `agent/src/com/vibecode/agent/AgentConfig.java`

**Add fields** (after `AI_API_KEY`):
```java
public static final String REPO_CLONE_DIR = getEnv("REPO_CLONE_DIR", "/repos");
public static final int MAX_FILE_WRITE_RETRIES = getEnvInt("MAX_FILE_WRITE_RETRIES", 3);
public static final boolean DRY_RUN = getEnvBool("DRY_RUN", false);
```

**Add helper method**:
```java
private static boolean getEnvBool(String name, boolean defaultValue) {
    String val = getEnv(name, "");
    if (val.isEmpty()) return defaultValue;
    return Boolean.parseBoolean(val);
}
private static int getEnvInt(String name, int defaultValue) {
    String val = getEnv(name, "");
    if (val.isEmpty()) return defaultValue;
    try { return Integer.parseInt(val); } catch (NumberFormatException e) { return defaultValue; }
}
```

### MODIFY: `agent/src/com/vibecode/agent/TicketProcessor.java`

**In the processTicket() method, after generateContent() call and before createPR()**:

```java
// Parse file operations from AI response
List<FileOperation> files = FileOperation.parseFromJson(aiResponse);
if (!files.isEmpty()) {
    workspaceManager.writeFiles(files);
    String commitSha = workspaceManager.commitAndPush("feat: " + ticket.getTitle());
    prBody += "\n\nCommit: " + commitSha;
}
```

**Imports to add**:
```java
import java.util.List;
```

## Test Expectations

### Manual verification
```
✓ Agent with DRY_RUN=true logs file operations without writing
✓ WorkspaceManager.cloneRepo clones repo to REPO_CLONE_DIR/{repo-name}
✓ WorkspaceManager.writeFiles creates directories and writes content
✓ WorkspaceManager.commitAndPush stages, commits, pushes
✓ getCommitSha() returns non-empty SHA after commit
✓ Agent creates non-empty PR with commit SHA in body
```

## Edge Cases to Handle

1. **Repo already cloned**: skip clone, just checkout/create branch
2. **File path with subdirectories**: create parent dirs before writing
3. **Empty file list**: skip commit, log "No files changed"
4. **Git auth failure**: log error, release ticket with "Git authentication failed"
5. **Binary files in AI output**: skip files containing null bytes, log warning
6. **Concurrent git operations**: not handled — each agent works on its own branch

## Existing Code Patterns to Follow

- Use SLF4J Logger for all logging (existing pattern)
- Use Jackson for JSON parsing (existing pattern via ApiService)
- ProcessBuilder for external commands (OkHttp for HTTP)
- Error handling: throw RuntimeException with descriptive message
