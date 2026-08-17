# bp-114: GitHubService Auth Token Fix (BUG 5)

## Ticket Information
- **ID**: bp-114
- **Priority**: P1 (critical — all GitHub operations fail silently)
- **Type**: Bug Fix
- **Scope**: Java agent only (agent/)

## Problem Statement

The Java agent's `GitHubService` is constructed with `config.getAgentApiKey()` (the Vibecode backend API key) instead of a GitHub Personal Access Token (PAT). Every call to `api.github.com` sends the backend API key as `Authorization: token {AGENT_API_KEY}`, which GitHub rejects with `401 Unauthorized`. This causes all GitHub operations (branch create, commit, PR, clone) to fail silently.

### Data Flow

**Correct (backend):**
```
User enters GitHub PAT in frontend → POST /api/v1/github/{projectId}/repo/connect
  → GitHubService.connectProject() encrypts & stores in project_repos.access_token_encrypted
  → GitHubService.createTicketBranch() decrypts & passes to GitHubProvider
  → GitHubProvider creates Octokit(token) → authenticated calls to api.github.com
```

**Broken (Java agent):**
```
Agent starts with AGENT_API_KEY env var
  → AgentApp constructor: new GitHubService(config.getAgentApiKey(), ...)
  → GitHubService stores AGENT_API_KEY as authToken
  → Every api.github.com call sends: Authorization: token {AGENT_API_KEY}
  → GitHub returns 401 Unauthorized → IOException → ticket processing fails
```

## Root Cause

`AgentConfig.java` has no `GITHUB_TOKEN` environment variable. `AgentApp.java:49` passes `config.getAgentApiKey()` (backend API key) to `GitHubService` constructor where it is used as the GitHub auth token.

## Solution

### Option A: New ENV var + Backend API fetch (Recommended)

1. Add `GITHUB_TOKEN` env var to `AgentConfig.java`
2. In `AgentApp.java`, fetch project repo config from backend (`GET /api/v1/github/{projectId}/repo`) before creating GitHubService
3. Use the returned `accessToken` if available, fall back to `GITHUB_TOKEN` env var
4. Also use the token for git clone operations (private repos)

### Option B: Backend proxy (larger scope)

Have the backend proxy all GitHub API calls on behalf of the agent. Too large for this ticket.

## Implementation Plan

### 1. AgentConfig.java — Add GITHUB_TOKEN env var
- Add `private final String githubToken;` field
- Add `requireEnv("GITHUB_TOKEN", null)` for optional GitHub token
- Add `getGitHubToken()` getter

### 2. AgentApp.java — Fetch GitHub PAT from backend
- Add call to `apiService.getRepoConfig(projectId)` at startup (before creating GitHubService)
- Extract `accessToken` from response
- Pass to GitHubService constructor: `new GitHubService(githubToken, ...)`
- Store token for git clone operations in WorkspaceManager

### 3. ApiService.java — Add getRepoConfig() method
- `GET /api/v1/github/{projectId}/repo` endpoint
- Returns `{ success: true, data: { repoUrl, accessToken } }`

### 4. Backend GitHubController.js — Add GET /:projectId/repo endpoint
- Verify user has PROJECT_UPDATE permission
- Decrypt and return `access_token` from `project_repos`
- Return `repoUrl` for clone operations

### 5. WorkspaceManager.java — Use token for git clone
- Modify `cloneRepo()` to include token in URL: `https://{token}@github.com/...`
- Or use `GIT_ASKPASS` mechanism for private repos

## Files to Change

| File | Changes |
|------|---------|
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | Add GITHUB_TOKEN env var |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | Fetch PAT from backend, pass to GitHubService |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | Add getRepoConfig() method |
| `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java` | Use token for git clone |
| `backend/src/api/github.js` | Add GET /:projectId/repo endpoint |
| `agent/src/test/java/com/vibecode/agent/service/GitHubServiceTest.java` | New test file |

## Testing

- Unit: GitHubServiceTest with mocked OkHttp responses
- Unit: AgentConfigTest for GITHUB_TOKEN optional env var
- Unit: WorkspaceManagerTest for private repo clone with token
- Integration: Full ticket flow with mock GitHub API

## Out of Scope

- Git credential helper setup (use URL embedding for simplicity)
- Token refresh/expiry handling (GitHub PATs are long-lived)
- Multi-repo support (agent is single-repo scoped)

## Deferred Improvements Found

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-112 | Java agent unit tests (comprehensive) | Testing | bp-118-java-agent-unit-tests |
| 2 | bp-113 | Route-level permission guards for new routes | Security | bp-115-route-permission-guards |
| 3 | fg-13 | Planning file usage UI (per-file history) | UX | bp-116-planning-file-usage-ui |
| 4 | fg-13 | Route mount audit script | Developer experience | bp-117-route-mount-audit |
| 5 | bp-99 | Runtime provider config hot reload | Feature | bp-119-provider-config-hot-reload |
