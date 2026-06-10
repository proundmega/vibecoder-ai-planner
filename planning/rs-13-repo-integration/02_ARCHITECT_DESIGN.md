# 02_ARCHITECT_DESIGN.md — GitHub Repository Integration

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

AI agents need a real repository to work on. Currently they operate in isolation. We need to connect Vibecode projects to GitHub repos so agents can create branches, commit code, and open PRs automatically.

---

## Current State

- Projects table exists with `name`, `description`, `slug`
- Tickets table exists with `status`, `description`
- No repository integration
- No branch/PR management

---

## Design

### Architecture

```
Project → GitHub Connection (PAT/SSH key) → GitHub API
                                          → Branches
                                          → PRs
                                          → Commits
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS project_repos (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'github',  -- 'github' for now
  repo_url TEXT NOT NULL,                          -- e.g., 'owner/repo' or full URL
  access_token_encrypted TEXT NOT NULL,            -- encrypted GitHub PAT
  default_branch VARCHAR(255) DEFAULT 'main',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider CHECK (provider = 'github'),
  CONSTRAINT unique_project_repo UNIQUE (project_id, provider)
);

CREATE INDEX idx_project_repos_project_id ON project_repos(project_id);
CREATE INDEX idx_project_repos_is_active ON project_repos(is_active);
```

### Branch Naming Convention

```
vibecode/ticket-{id}-{slug}
```

Where `{slug}` is a URL-safe version of the ticket title (max 50 chars).

**Example:** `vibecode/ticket-42-fix-auth-middleware`

### PR Workflow

```
1. Ticket defined (ARCHITECT templates filled)
2. Agent picks up ticket → status: 'in_progress'
3. Agent creates branch: git checkout -b vibecode/ticket-{id}-{slug}
4. Agent codes, commits
5. Agent pushes branch to GitHub
6. Agent triggers PR creation manually
7. PR created with description referencing ticket
8. PR link stored in ticket notes
9. Ticket status: 'review' (awaiting human/AI review)
```

### GitHub API Integration

**Provider folder structure:**
```
backend/src/providers/
  github/
    index.js          → main exports
    api.js            → GitHub API client (octokit wrapper)
    branch.js         → branch operations (create, list, delete)
    pr.js             → PR operations (create, list, update)
    commit.js         → commit operations
    auth.js           → PAT validation and token management
```

**Key methods:**
```javascript
// github/api.js
class GitHubAPI {
  constructor(token) { ... }
  async createBranch(owner, repo, branch, fromRef) { ... }
  async createCommit(owner, repo, branch, message, files) { ... }
  async pushBranch(owner, repo, branch) { ... }
  async createPR(owner, repo, title, body, head, base) { ... }
  async validateToken(owner, repo) { ... }
}

// github/branch.js
async function createTicketBranch(projectRepo, ticket) {
  const branchName = `vibecode/ticket-${ticket.id}-${slugify(ticket.title, 50)}`;
  await api.createBranch(
    projectRepo.owner,
    projectRepo.repo,
    branchName,
    projectRepo.defaultBranch
  );
  return branchName;
}

// github/pr.js
async function createTicketPR(projectRepo, ticket, branchName, prDescription) {
  const pr = await api.createPR(
    projectRepo.owner,
    projectRepo.repo,
    `[Ticket #${ticket.id}] ${ticket.title}`,
    prDescription,
    branchName,
    projectRepo.defaultBranch
  );
  return pr;
}
```

### Encryption

PATs encrypted using a project-level encryption key (derived from a master key in env):
```javascript
// backend/src/services/GitHubService.js
const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.GITHUB_ENCRYPTION_KEY; // 32 bytes hex

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(MASTER_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(MASTER_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Defense in Depth

| Layer | Responsibility |
|-------|---------------|
| **Route** | `verifyToken` + `requireAnyPermission('PROJECT_MANAGE_MEMBERS')` |
| **Controller** | Validate project ownership, decrypt PAT |
| **Service** | Business logic: branch creation, PR creation |
| **Provider** | GitHub API calls, error handling |

---

## Dependencies

- `octokit` or `@octokit/rest` — GitHub API client
- `crypto` — Node.js built-in for encryption
- `slugify` — URL-safe branch names
- `process.env.GITHUB_ENCRYPTION_KEY` — 32-byte hex master key

---

## Risks/Edge Cases

- **[PAT expiration]**: GitHub PATs expire — detect 401 and notify project_admin
- **[Rate limits]**: GitHub API has rate limits — implement retry with exponential backoff
- **[Branch conflicts]**: Multiple agents on same project — ticket ownership prevents this
- **[Large files]**: Agents shouldn't commit binary files — add size limit check
- **[Sensitive data]**: PATs must never be logged or returned in API responses
- **[Repo permissions]**: PAT must have `repo` scope — validate on connect
- **[Network failures]**: GitHub API downtime — queue PR creation for retry

---

## Migration Notes

```sql
-- Migration: 007_project_repos.sql
CREATE TABLE IF NOT EXISTS project_repos (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  default_branch VARCHAR(255) DEFAULT 'main',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider CHECK (provider = 'github'),
  CONSTRAINT unique_project_repo UNIQUE (project_id, provider)
);
CREATE INDEX idx_project_repos_project_id ON project_repos(project_id);
CREATE INDEX idx_project_repos_is_active ON project_repos(is_active);
```

---

*This document defines the design for GitHub repository integration. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
