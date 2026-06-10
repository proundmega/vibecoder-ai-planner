# 03_ARCHITECT_IMPLEMENTATION.md — GitHub Repository Integration

**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-13-repo-integration

**Dependencies**: rs-15-api-keys (encryption infrastructure), rs-16-agent-orchestration (agent needs repo context)

---

### a) Purpose

Connect Vibecode projects to GitHub repositories so AI agents can work on real code. Agents create feature branches, commit changes, and open PRs — all tracked within Vibecode tickets. This turns Vibecode from a planning tool into a full development coordination platform.

**Value delivered**: Agents work on real repos with PRs, not isolated sandboxes. Project admins get traceable, reviewable code changes with full audit trail in Vibecode.

---

### b) Actions

1. **Create migration** — `backend/src/migrations/007_project_repos.sql`
   - `project_repos` table with encrypted PAT storage
   - Constraints: unique per project, GitHub-only provider

2. **Create provider structure** — `backend/src/providers/github/`
   ```
   backend/src/providers/github/
     index.js          → exports GitHubProvider class
     api.js            → Octokit wrapper, rate limit handling
     branch.js         → create/list/delete branches
     pr.js             → create/list PRs, add PR link to ticket
     commit.js         → commit operations (future)
     auth.js           → PAT validation, encryption helpers
   ```

3. **Create GitHubService** — `backend/src/services/GitHubService.js`
   - `connectProject(projectId, repoUrl, accessToken)` → validates PAT, encrypts, saves
   - `disconnectProject(projectId)` → removes connection
   - `getProjectRepo(projectId)` → returns decrypted repo config
   - `createTicketBranch(projectId, ticket)` → creates `vibecode/ticket-{id}-{slug}`
   - `createTicketPR(projectId, ticket, branchName, description)` → creates PR, stores link

4. **Create controllers** — `backend/src/controllers/githubController.js`
   - `connectRepo(req, res, next)` → POST `/api/projects/:id/repo/connect`
   - `disconnectRepo(req, res, next)` → DELETE `/api/projects/:id/repo`
   - `getRepoStatus(req, res, next)` → GET `/api/projects/:id/repo`
   - `createBranch(req, res, next)` → POST `/api/tickets/:id/branch`
   - `createPR(req, res, next)` → POST `/api/tickets/:id/pr`

5. **Create routes** — `backend/src/api/github.js`
   - `POST /api/projects/:id/repo/connect` — connect GitHub repo
   - `DELETE /api/projects/:id/repo` — disconnect
   - `GET /api/projects/:id/repo` — get repo status
   - `POST /api/tickets/:id/branch` — create ticket branch
   - `POST /api/tickets/:id/pr` — create PR from ticket branch

6. **Create tests**
   - `backend/src/__tests__/githubService.test.js` — service unit tests
   - `backend/src/__tests__/githubController.test.js` — controller unit tests
   - `backend/src/__tests__/integration/github-integration.test.js` — mock GitHub API

7. **Update existing models**
   - `Ticket` model: add `branch_name`, `pr_url`, `pr_state` columns
   - Migration: `008_ticket_repo_fields.sql`

---

### c) Dependencies

- **octokit** — `@octokit/rest` for GitHub API
- **slugify** — URL-safe branch names
- **crypto** — Node.js built-in for PAT encryption
- **process.env.GITHUB_ENCRYPTION_KEY** — 32-byte hex master key
- **rs-15-api-keys** — shared encryption infrastructure
- **rs-16-agent-orchestration** — agents need repo context

---

### d) Risks/Edge Cases

- **[PAT expiration]**: GitHub PATs expire — detect 401 and notify project_admin
- **[Rate limits]**: GitHub API has 5000/hr authenticated limit — implement retry with exponential backoff
- **[Branch conflicts]**: Ticket ownership prevents multiple agents on same ticket
- **[Large files]**: Add 10MB file size limit to prevent binary commits
- **[Sensitive data]**: PATs must never be logged or returned in API responses
- **[Repo permissions]**: PAT must have `repo` scope — validate on connect with `GET /user/repos`
- **[Network failures]**: Queue PR/branch creation for retry with exponential backoff

---

### e) Testing

#### Unit Tests
- [ ] GitHubService.connectProject() — encrypts and stores PAT
- [ ] GitHubService.createTicketBranch() — creates branch with correct naming
- [ ] GitHubService.createTicketPR() — creates PR with ticket reference
- [ ] GitHubService.disconnectProject() — removes connection
- [ ] Encryption/decryption roundtrip
- [ ] PAT validation (valid vs invalid token)

#### Integration Tests
- [ ] Full request lifecycle: connect repo → create branch → create PR
- [ ] Error handling: invalid PAT, rate limit, network failure
- [ ] Branch naming: slugified title, max 50 chars, unique

#### Frontend Tests
- [ ] Component: Repo connection form (PAT input, repo URL)
- [ ] Component: PR link displayed in ticket detail

---

### f) Migration Notes

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

-- Migration: 008_ticket_repo_fields.sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pr_url TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pr_state VARCHAR(20) DEFAULT 'open';
CREATE INDEX idx_tickets_branch_name ON tickets(branch_name);
```

---

### g) Notes

- Branch naming: `vibecode/ticket-{id}-{slug}` — prefix ensures no conflicts with existing branches
- PR title: `[Ticket #${id}] ${title}` — clear reference to Vibecode ticket
- PR body: includes ticket description, ARCHITECT notes, and status
- PAT encryption: AES-256-GCM with IV + auth tag stored alongside ciphertext
- Rate limiting: retry after 429 with exponential backoff (1s, 2s, 4s, 8s)
- GitHub provider folder keeps extension easy (GitLab, Bitbucket later)

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, layer responsibilities, encryption, branch naming*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
