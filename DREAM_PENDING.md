# DREAM_PENDING.md — Unplanned Phases & Gaps

> Refined build order after user input. Each row becomes a `planning/bp-XX/` suite.

## Build Order (Next Batch)

| # | Ticket | Directory | Effort | Depends On |
|---|--------|-----------|--------|------------|
| 1 | **Gap B: TemplateService redesign** | `bp-31-template-service-redesign` | Medium | — |
| 2 | **Gap A: PhaseFlow.vue guided UI** | `bp-32-phase-flow-ui` | Large | bp-26 (phase machine) |
| 3 | **Phase 8: Agent heartbeat & liveness** | `bp-33-agent-heartbeat` | Medium | bp-24 (agent writes code) |
| 4 | **Phase 9a: Code review — GitHub PR diff** | `bp-34-code-review-github` | Medium | bp-24 (agent creates PRs) |
| 5 | **Phase 9b: Code review — local file changes** | `bp-35-code-review-local` | Medium | bp-24 (agent workspace) |
| 6 | **Phase 10: Pool manager (Tier 2 compute)** | `bp-36-pool-manager` | Large | bp-33 (heartbeat), bp-29 (provider config) |
| 7 | **Phase 11: Deployment pipeline** | `bp-37-deploy-pipeline` | Medium | bp-26 (phase machine, `done`/`deployed` phases) |
| 8 | **Phase 12: Web terminal proxy** | `bp-38-web-terminal` | Large | bp-36 (pool manager — need agent containers) |
| 9 | **Phase 13: Milestones & timeline** | `bp-39-milestones` | Medium | bp-26 (phase machine) |
| 10 | **Phase 14: Dynamic provisioning (Tier 3)** | `bp-40-dynamic-provisioning` | Large | bp-36 (pool manager), bp-29 (credential store) |
| 11 | **Phase 15: Per-ticket model routing** | `bp-41-model-routing` | Medium | bp-29 (provider config), bp-25 (OpenAI-compatible adapter) |

---

## Design Decisions Made

| Decision | Chosen Approach |
|----------|----------------|
| PhaseFlow.vue vs. kanban | Both — toggleable. Guided flow is default, compact kanban as optional view. |
| Code Review diff source | Two tickets: GitHub PR diff + local file changes. Build both. |
| Deployment | Webhook-only. Users define environments per project via UI. Simple webhook POST with ticket metadata. |
| Pool Manager Docker API | Node.js `dockerode` npm package. Mount Docker socket. |
| Heartbeat offline detection | Hard timeout — 2 missed heartbeats (60s stale). Frontend polls `GET /agents` every 10s. |
| Web Terminal access | Super admin only. |
| Milestones | One active milestone per project at a time. |
| Dynamic provisioning | SSH keys stored in credential store. Static host config (no auto-enrollment). Agents reach backend via configurable `BACKEND_URL`. |
| Model routing | Deferred — no complexity estimation mechanism yet. Ticket will define routing rules schema. |
| Idle compute trigger (Gap C) | Future concern — not ticketed now. |
| Non-developer UX (Gap D) | Future concern — tracked in this file, not ticketed. |

---

## Detailed Phase Definitions

### bp-31: TemplateService Redesign (Gap B)

**Why before everything else**: The template content served by `TemplateService.js` is outdated per the DREAM.md spec. All future tickets that generate planning docs will produce the old format unless we fix this first.

**What**:
- Rewrite 4 existing Architect template content methods (00–03) with new structured layouts from DREAM.md
- Add 5th file `04_SPECIFICATION.md` to the Architect template
- Add a new standalone `SPECIFICATION` template (1 file: the execution spec)
- Update template metadata in the static lookup
- The `04_SPECIFICATION.md` content design is fully specified in DREAM.md §"New: Specification Template"
- The 00–03 redesigned structures are specified in DREAM.md §"Updated Architect Template"

**No DB changes. No frontend changes.** Pure service-layer change to `backend/src/services/TemplateService.js`.

---

### bp-32: PhaseFlow.vue (Gap A)

**Why**: bp-26 builds the backend phase machine (column + transition validation). The UI is still a flat kanban board. The dream requires per-phase dedicated screens.

**What** (per DREAM.md table):

| Phase | UI Screen |
|-------|-----------|
| draft | Title + description + priority form |
| planning | Template selector → fill planning docs → mark ready |
| plan_approved | Read-only plan view + approve/reject |
| assigned | Agent selector (or auto-assign), shows available agents + load |
| in_progress | Real-time status feed from agent + Feedback tab |
| blocked | Agent's question + human reply form |
| review | Diff viewer (from bp-34/35) + line comments + approve/reject |
| human_approval | Summary of changes + approve/reject |
| done | "Deploy to [environment]" button from bp-37 |
| deployed | Deployment info (env, timestamp, rollback button) |

**Toggleable**: A "Compact view" toggle reverts to the old 4-column kanban (keeps existing `TicketBoard.vue` accessible).

**Architecture**: New route `/projects/:id/tickets/:id/flow` with the `PhaseFlow.vue` component. The existing `TicketBoard.vue` and `TicketDetail.vue` remain for compact mode and backward compatibility.

---

### bp-33: Agent Heartbeat & Liveness (Phase 8)

**Why**: Without this, you can't tell if an agent is alive or silently dead. Agents that crash leave tickets locked and no one notices.

**What**:
- New DB table: `agent_heartbeats`:
  ```sql
  CREATE TABLE agent_heartbeats (
      agent_id VARCHAR(64) PRIMARY KEY,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      current_ticket_id UUID REFERENCES tickets(id),
      current_step VARCHAR(64),
      memory_usage JSONB,
      cpu_usage JSONB,
      status VARCHAR(16) NOT NULL DEFAULT 'online'
  );
  ```
- Agent sends `POST /agents/:id/heartbeat` every 30s (via existing `ApiService.java`)
- Backend marks agent offline after 2 missed heartbeats (60s stale) via a periodic cleanup job
- Stale agents → auto-release their locked tickets (call `TicketService.release()`)
- Frontend: new `/agents` route with `AgentList.vue` — shows all agents with online/idle/offline status, current ticket, actions completed today, total cost
- Frontend: agent detail view with history of actions, cost breakdown per ticket
- Frontend polls `GET /api/v1/agents` every 10s

**Backend endpoints**:
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/agents/:id/heartbeat` | Agent reports liveness |
| `GET` | `/api/v1/agents` | List all agents with status |
| `GET` | `/api/v1/agents/:id` | Agent detail + history |

**Decisions**:
- Hard timeout: 2 missed heartbeats = offline
- Frontend polling, not WebSocket
- No graceful shutdown signal for now — just timeout

---

### bp-34: Code Review UI — GitHub PR Diff (Phase 9a)

**Why**: Approval currently just toggles status to `done`. No one sees the diff. The GitHub PR exists but the review happens outside the system.

**What**:
- Fetch PR diff from GitHub API when ticket has a linked PR
- Render diff in split or unified view (use a library like `diff2html` or custom Vue component)
- Line-level commenting: click a line → add comment → stored in `ticket_comments` with `file_path` and `line_number` metadata
- "Request changes" button → posts a summary, transitions ticket back to `in_progress`
- "Approve" button → transitions to `human_approval` phase
- Status sync: poll PR status from GitHub (or webhook in future)

**Frontend**: New tab in PhaseFlow.vue's review phase, or standalone `/projects/:id/tickets/:id/review` route.

**Backend**: Minimal — most logic is frontend rendering of the diff fetched from GitHub API via existing `GitHubService.java`.

---

### bp-35: Code Review UI — Local File Changes (Phase 9b)

**Why**: Not all projects use GitHub. Agents working with local repos need diff visibility too.

**What**:
- Instead of fetching from GitHub API, compute diff from the agent's workspace files
- Backend `POST /tickets/:id/review/diff` — agent uploads its file changes (list of {path, old_content?, new_content}) after completing work
- Frontend renders the same diff viewer as bp-34 but from this local data source
- Same line-commenting + approve/request-changes logic

**Reuses**: Same Vue diff component as bp-34, same commenting backend, same approval logic.

---

### bp-36: Pool Manager (Phase 10 — Tier 2 Compute)

**Why**: Manually running `docker compose up --scale agent=N` doesn't scale. Need automatic agent lifecycle managed by the backend.

**What**:
- New service: `PoolManager.js` (Node.js) using `dockerode` npm package
- Pool manager needs Docker socket access (`/var/run/docker.sock`)
- Agent image: pre-built from `agent/Dockerfile` (needs creation) or existing `openjdk:17` with fat JAR

**Backend endpoints**:
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/pool/request` | Find or spawn agent for a project |
| `POST` | `/api/pool/release` | Release agent back to pool or destroy |
| `GET` | `/api/pool/status` | List all managed agents |

**Flow**:
1. Ticket enters `assigned` phase
2. Backend calls `POST /pool/request` with `{ project_id, repo_url, provider_config }`
3. Pool manager checks idle agents: if one exists with repo cached → assign. Else spawn new container.
4. Spawn: `docker.run('vibecode-agent', { Env: [...], HostConfig: { Binds: ['repos:/repos'] } })`
5. Agent polls backend, picks up ticket, works it
6. When ticket reaches `done` or agent is idle for 5 min → pool manager destroys container

**New DB table?** — Pool state can be in-memory (Map) for simplicity, with agent_heartbeats (bp-33) as the persistent source of truth for active agents.

---

### bp-37: Deployment Pipeline (Phase 11)

**Why**: Ticket reaches `done` and stops. No deploy. No environments. No rollback.

**What**:
- New DB table: `environments`:
  ```sql
  CREATE TABLE environments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(64) NOT NULL,
      webhook_url VARCHAR(512) NOT NULL,
      branch_pattern VARCHAR(128) DEFAULT '*',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
- New DB table: `deployments`:
  ```sql
  CREATE TABLE deployments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES tickets(id),
      environment_id UUID NOT NULL REFERENCES environments(id),
      status VARCHAR(16) DEFAULT 'pending',
      commit_sha VARCHAR(64),
      deployed_at TIMESTAMPTZ DEFAULT NOW(),
      rolled_back_at TIMESTAMPTZ,
      metadata JSONB
  );
  ```

**Backend endpoints**:
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/projects/:id/environments` | List environments |
| `POST` | `/api/v1/projects/:id/environments` | Create environment |
| `DELETE` | `/api/v1/environments/:id` | Delete environment |
| `POST` | `/api/v1/tickets/:id/deploy` | Trigger deploy to environment |
| `POST` | `/api/v1/deployments/:id/rollback` | Rollback a deployment |

**Deploy flow**:
1. User clicks "Deploy to [environment]" on a `done` ticket
2. Backend creates deployment record (status=pending)
3. Backend POSTs to environment's webhook URL with JSON body:
   ```json
   { "ticket_id": "...", "branch": "feature/...", "commit_sha": "...", "project": "...", "environment": "staging" }
   ```
4. Frontend polls deployment status (or webhook callback updates it)
5. Rollback: POST to same webhook with `{ "action": "rollback", "deployment_id": "..." }`

**Frontend**: Deploy button in PhaseFlow.vue's `done` phase screen. Environment management tab in ProjectDetail.vue. Deployment history view.

---

### bp-38: Web Terminal Proxy (Phase 12)

**Why**: When agent questions aren't enough for debugging, the human needs direct workspace access.

**What**:
- Backend service: `TerminalProxy.js` — WebSocket server that proxies `docker exec` commands
- Uses `dockerode` exec API to create an interactive shell session in the agent's container
- Frontend: `xterm.js` + `attach-addon` for terminal UI at `/agents/:id/terminal`
- Session management: connect/disconnect per agent container
- Access control: super_admin only

**Backend endpoint**:
| Upgrade | Path | Purpose |
|---------|------|---------|
| WebSocket | `/api/terminal/:agentId` | WebSocket upgrade to terminal session |

**Frontend**: New route `/agents/:id/terminal` with full terminal UI. No file viewer — just the shell.

**Implementation** (simplified):
```javascript
// TerminalProxy.js — uses dockerode
async function createSession(agentId) {
    const container = docker.getContainer(agentId);
    const exec = await container.exec({
        Cmd: ['/bin/bash', '-l'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
    });
    const stream = await exec.start({ Tty: true, stdin: true });
    return stream;  // pipe to WebSocket
}
```

---

### bp-39: Milestones & Timeline (Phase 13)

**Why**: No milestones, no sprints, no release grouping. Tickets are an undifferentiated list.

**What**:
- New DB table: `milestones`:
  ```sql
  CREATE TABLE milestones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(128) NOT NULL,
      description TEXT,
      target_date DATE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(project_id, is_active)  -- only one active per project
  );
  ```
- Add `milestone_id` FK to `tickets` table
- Add `estimate` column (integer, story points) and `depends_on` (UUID → tickets.id) to tickets table

**Backend endpoints**:
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/projects/:id/milestones` | List milestones |
| `POST` | `/api/v1/projects/:id/milestones` | Create milestone (auto-deactivates others) |
| `PUT` | `/api/v1/milestones/:id` | Update milestone |
| `GET` | `/api/v1/milestones/:id/tickets` | Tickets in milestone with progress |

**Frontend**: Milestone tab in ProjectDetail.vue. Sprint view: filtered board with estimate vs. actual progress bar. Ticket dependency graph (simple "depends on" picker).

**Dependency enforcement**: TicketService checks that all dependencies are in `done` phase before allowing transition to `in_progress`.

---

### bp-40: Dynamic Provisioning (Phase 14 — Tier 3)

**Why**: Scale beyond one machine. Use spare laptops, homelab, NAS as agent workers.

**What**:
- New DB table: `compute_nodes`:
  ```sql
  CREATE TABLE compute_nodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hostname VARCHAR(256) NOT NULL,
      ssh_user VARCHAR(64) NOT NULL,
      ssh_key_credential_id UUID NOT NULL REFERENCES credentials(id),
      labels JSONB DEFAULT '{}',
      capacity INTEGER DEFAULT 1,
      status VARCHAR(16) DEFAULT 'offline',
      last_seen TIMESTAMPTZ,
      UNIQUE(hostname)
  );
  ```

**Pool manager extension** (`PoolManager.js`, from bp-36):
- On `POST /pool/request`:
  1. Check local Docker for capacity
  2. If local full, query `compute_nodes` for online nodes with capacity
  3. Pick best host (least loaded, has repo cached, has required AI model)
  4. SSH into host: `ssh -i {key} {user}@{hostname} 'docker run -d --name agent-{id} vibecode-agent'`
  5. Track which host is running which agent
- On `POST /pool/release`:
  1. SSH into host: `docker stop agent-{id} && docker rm agent-{id}`

**SSH key management**: Keys stored in existing credential store (encrypted). Pool manager decrypts at runtime, uses SSH agent or temp key file.

**New dependency**: `ssh2` npm package for programmatic SSH.

---

### bp-41: Per-Ticket Model Routing (Phase 15)

**Why**: An "easy" ticket (typo fix, test addition) shouldn't use the same expensive model as a complex architectural change. Route cheap tickets to fast local models, complex ones to powerful cloud models.

**What**:
- Add `routing_rules` JSONB column to `provider_configs` table (already exists from bp-29)
- Routing rule format:
  ```json
  {
    "rules": [
      { "match": { "labels": ["bug", "typo"] }, "provider": "ollama", "model": "codellama:7b" },
      { "match": { "priority": "low" }, "provider": "ollama", "model": "qwen2.5-coder:14b" },
      { "match": { "labels": ["feature", "architecture"] }, "provider": "claude", "model": "claude-sonnet-4-20250514" }
    ],
    "fallback": { "provider": "openai", "model": "gpt-4o" }
  }
  ```
- `ProviderService.resolveProvider(projectId, ticket)` evaluates rules top-to-bottom, returns first match
- If matched provider fails → retry with fallback
- If no rules match → use project's default provider config

**Agent integration**: Agent fetches resolved provider config via `POST /api/v1/projects/:id/provider/resolve` at ticket pickup.

**Complexity estimation**: Not included in this ticket. The initial routing is label/priority-based only. ML-based complexity estimation is deferred to a future phase.

---

## Future / Not Ticketed

| Gap | Reason | Trigger to Ticket |
|-----|--------|-------------------|
| **Gap C: Idle compute trigger** | System doesn't work end-to-end yet. No point detecting idle when agents aren't running. | After pool manager (bp-36) is proven stable with real agent workloads. |
| **Gap D: Non-developer UX** | The UI needs to be feature-complete first. Polish for non-devs is wasted if core flows are missing. | After all phases 1–15 are implemented and working. Track onboarding flow, terminology, simplified ticket creation. |
| **ML complexity estimator** | No training data. Need real ticket → model → outcome data first. | After 100+ tickets have been processed by the system. |
