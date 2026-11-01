# 02_ARCHITECT_DESIGN.md — Autonomous Coding Harness

**Status**: planned
**Author**: AI Assistant
**Scope**: Both (agent, backend, frontend, infrastructure)
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

The current agent is a blind code generator. It receives a ticket, planning documents and a list of
repository paths, then asks a model to emit complete file contents as JSON. It cannot read existing
code, run tests, inspect failures or ask questions. As a result it can only create simple new files
reliably and cannot safely modify a real codebase.

We need an execution harness with real tools and a feedback loop, plus a durable human-in-the-loop
protocol so the agent can pause, ask, and resume without holding a process hostage.

---

## Current State

### Existing Agent

```
AgentApp (poll every 30s)
  → ApiService.listBacklogTickets()
  → TicketProcessor.processTicket()
      → pickup ticket
      → fetch planning docs
      → clone repo
      → AI: ticket + planning + file LIST → JSON {files:[{path,content,action}]}
      → write full files
      → commit + push
      → create PR
      → status = review
  → ReviewProcessor (PR diff → AI comments)
```

Key limitations:

- `WorkspaceManager.getRepoFileList()` returns paths only. No file contents are ever sent.
- `AiProvider.generateResponse(system, user)` is single-shot; no tool calls, no observations.
- No command execution; tests are never run by the agent.
- No recoverable human interaction; failures are released back to backlog.
- No session record; only free-form ticket messages.

### Existing Backend

- Tickets, phases (`blocked` exists), messages, approvals, agents, provider configs, usage logs,
  heartbeats, compute nodes and Docker-based agent pools.
- `/api/v1/tickets/:ticketId/messages` accepts agent or JWT auth.
- No questions, notifications, sessions, policies or transcript tables.
- Frontend does not render ticket messages.

### Gap Analysis

| Need | Exists | Gap |
|---|---|---|
| Repo editing with tools | No | Harness |
| Test/lint loop | No | Harness supervisor + verification |
| Human question mid-task | No | Question table/API + notification + resume |
| Agent transcript/audit | No | Session/event tables |
| Autonomy policy | No | Policy table + risk classifier |
| Web UI for questions | No | Bell + question inbox + ticket card |
| PR-only publishing | Partial | Supervisor-owned commit/push/PR |

---

## Design

### Recommended: OpenCode server as the execution harness

Run the **OpenCode server** (`opencode serve`) inside the agent sandbox, one server per ticket,
with the ticket workspace as its project directory. The Java agent becomes a **Harness Supervisor**
that:

1. clones the repo and creates the ticket branch,
2. writes a temporary OpenCode config (provider, model, permissions, instructions),
3. starts the server and creates a session,
4. sends the implementation prompt,
5. consumes the SSE event stream and maps it to planner state (heartbeat, messages, questions, usage),
6. answers permission requests according to policy or by asking the human,
7. verifies the result, commits/pushes, opens the PR,
8. tears the server and workspace down.

Why OpenCode:

- It already implements the tools we need: `read`, `grep`, `glob`, `edit`, `write`, `apply_patch`,
  `bash`, `todowrite`, LSP, subagents, web fetch/search and **a built-in `question` tool**.
- It has a headless HTTP server, an OpenAPI spec, session management, SSE events, session diffs,
  permission endpoints and form/question endpoints.
- It is the same harness the humans already use, so behaviour and prompt conventions are familiar.
- It supports many providers, including OpenAI-compatible custom providers and the OpenCode Console/Go
  gateway the user already has a key for.

The planner keeps ownership of tickets, phases, planning, approvals, usage, audit and UI. OpenCode is
replaceable behind a `HarnessClient` interface (future Claude Code/Codex adapters).

### Architecture

```
                     ┌──────────────────────────── Planner backend (Node) ───────────────────────────┐
                     │ tickets · phases · messages · approvals · usage · notifications · policies     │
                     └───────────▲──────────────────────────────▲──────────────────────────▲──────────┘
                                 │ JWT (human)                  │ X-API-Key (agent)        │ polling/SSE
                                 │                              │                          │
┌──────────────── Frontend (Vue) ┴────────────────┐   ┌─────────┴──────────────────────────┴──────────┐
│ Notification bell · Question inbox · Ticket      │   │ Harness Supervisor (Java agent)               │
│ Agent tab · Project autonomy settings            │   │  · polls backlog                              │
└──────────────────────────────────────────────────┘   │  · clones workspace + branch                  │
                                                       │  · starts OpenCode server (per ticket)        │
                                                       │  · maps SSE events → heartbeat/messages/usage │
                                                       │  · question/permission bridge                 │
                                                       │  · verification → commit/push/PR              │
                                                       └───────────────┬───────────────────────────────┘
                                                                       │ HTTP + SSE (localhost)
                                                       ┌───────────────▼───────────────────────────────┐
                                                       │ OpenCode server (sandboxed agent container)   │
                                                       │  sessions · tools · LSP · forms · permissions │
                                                       │  workspace: /repos/<agent>/<ticket>            │
                                                       └───────────────────────────────────────────────┘
```

### Option A — Extend the current JSON protocol (rejected)

Add file contents to the prompt and keep whole-file JSON operations.

- **Pros**: smallest change; works today.
- **Cons**: unbounded context, no tool loop, no tests, whole-file rewrites destroy unread code,
  no way to ask questions, no path to autonomy.
- **Decision**: rejected. This is the defect being fixed.

### Option B — Custom native tool loop (considered)

Implement tool calling, file edits, command execution, context compaction and permissions in Java.

- **Pros**: no new runtime; full control; consistent Java tests.
- **Cons**: months of work to reach parity with a mature harness (repo indexing, LSP, subagents,
  context compaction, edit heuristics). High risk of a worse result.
- **Decision**: not for Phase 1. Keep the `HarnessClient` abstraction so a native harness remains possible.

### Option C — OpenCode server harness (recommended)

- **Pros**: proven tools, sessions, permissions, forms/questions, SSE, diffs, provider support;
  fastest route to "works like a coding agent"; matches the user's existing workflow.
- **Cons**: new Node/OpenCode runtime in the agent image; API/SDK stability; larger image;
  sandbox hardening required.
- **Decision**: adopted, behind a feature flag and a `HarnessClient` interface.

### Option D — One-shot `opencode run` CLI (rejected)

- **Pros**: trivial integration.
- **Cons**: no durable question/permission loop, no resumable sessions, harder to stream events.
- **Decision**: rejected; server mode is required for human-in-the-loop.

---

## Harness Supervisor

### Lifecycle

1. **Pickup** — agent picks a backlog ticket (existing endpoint).
2. **Workspace** — clone repo, create branch `vibecode/ticket-<id>-<slug>`; clean previous workspace.
3. **Config** — sanitise the workspace, then render a temporary OpenCode config:
   - provider/model from the planner provider config, pointed at the supervisor's localhost
     `ProviderProxy` with a per-run dummy key,
   - permission rules (see policy matrix) with **no `ask` value** in Phase 1,
   - instructions/system prompt,
   - `question` tool denied in Phase 1 (enabled in Phase 2),
   - MCP server (optional) for planner reporting,
   - no secrets in the workspace; config lives outside the repo and is deleted after the run.
4. **Server** — start `opencode serve --hostname 127.0.0.1 --port <random>` with the workspace as cwd;
   health-check `/global/health`; enable basic auth with a per-run random password.
5. **Session** — create a session, **subscribe to `/api/event` first**, then send the prompt
   asynchronously (`POST /api/session/:id/prompt`). Never send the prompt before the subscription
   exists; the blocking `/message` endpoint is not used.
6. **Loop** — map events; enforce budgets; auto-reject unexpected permission requests; update heartbeat.
7. **Verification** — run the repo's configured verification commands in the workspace
   (`npm test`, `npm run lint`, `npm run typecheck`, `mvn test`, ...) regardless of what the agent ran.
8. **Publish** — if verification passes and the diff is allowed: commit, push branch, open PR via
   `GitHubService`; update `pr_url`; transition ticket to `review`. Agents never merge.
9. **Finish** — post a summary message with commands, test output and diff stats; close session and
   server; cleanup workspace; persist final usage.

### Prompt contract

The session prompt tells the harness agent:

- The ticket, planning docs, repository conventions (`AGENTS.md`, `ai/CODING.md`), and acceptance criteria.
- To inspect code before editing; use search/read tools.
- To make the smallest coherent change; no unrelated refactors.
- To follow test-first when the repo requires it; run tests/lint/typecheck.
- Phase 1: the `question` tool is disabled; make a reasonable, documented assumption. Phase 2: ask with
  the `question` tool only when a decision is genuinely blocked.
- To never run `git push`, `git commit`, merge, or access credentials; the supervisor publishes.
- To produce a final summary: files changed, tests run, risks, follow-ups.

### Event mapping

| OpenCode event (pin version) | Planner action |
|---|---|
| `session.created` / server connected | create `agent_sessions` row, heartbeat `starting` |
| message/tool part update (read/grep/edit) | heartbeat `current_step`; append compact `agent_events`; optional progress message every N tools |
| `bash` tool start/end | heartbeat; record command + exit code; post message only on failure or long-running commands |
| form/question created (Phase 2) | create `ticket_questions` (kind=question); phase → `blocked`; notification; park |
| form answered (Phase 2) | mark question answered; phase → `in_progress`; reply to OpenCode form endpoint |
| permission request (Phase 1) | **never expected** because no `ask` rule exists. If it still arrives, reply `reject` immediately, log a redacted warning, and continue; never block. |
| permission request (Phase 2) | policy engine: allow → reply `once/always`; deny → reply `reject`; ask → question (kind=permission) |
| usage update | accumulate tokens/cost into session + usage logs |
| `session.idle` | run verification; publish or fail |
| session error | post redacted failure message; Phase 1 releases to `backlog`; Phase 2 uses `blocked` + notification |
| session diff | collect changed files; protected-path check; diff stats |

Exact event names and payloads are pinned by the fake-server contract tests and verified against the
running OpenCode version's OpenAPI document.

### Human-in-the-loop protocol

```
Agent needs a decision
  → question tool / permission request
  → supervisor POST /tickets/:id/questions (agent auth)
      → ticket_questions row (pending)
      → ticket.phase = blocked
      → notification row for project admins/members
  → human sees bell/question card
  → POST /tickets/:id/questions/:qid/answer (JWT)
      → answer stored, status = answered
      → ticket.phase = in_progress
  → supervisor poll (5s) sees answer
  → replies to OpenCode form/permission
  → session continues
```

- While blocked, the agent process parks the ticket and moves on (or waits if configured single-ticket).
- Timeouts: `QUESTION_TIMEOUT_MINUTES` default 240; on expiry the question is `expired`, the session is
  aborted, the ticket is set to `blocked` with a message, and an escalation notification is created.
- Human answers are also posted as `comment`-type ticket messages for the audit trail.
- If the agent process restarts, pending sessions are reconciled: orphaned sessions marked `failed`;
  unanswered questions remain visible and answerable.

### Permission / risk policy

**Phase 1 is unattended.** Every rule must resolve to `allow` or `deny`; an `ask` rule is a startup
error. Safe commands are allowlisted, everything else is denied, and any unexpected permission
request is auto-rejected. The supervised/standard/autonomous matrix arrives with the Phase 2 bridge.

| Operation | Phase 1 (unattended) | Phase 2+ |
|---|---|---|
| read/glob/edit inside workspace | allow, except protected/secret paths | policy modes |
| `grep` | allow (secret files are removed from the workspace before start) | policy modes |
| run tests/lint/typecheck | allow via safe `shell` prefixes (`npm test *`, `npm run lint *`, `npm run typecheck *`, `mvn test *`, `pytest *`, `make test *`) | allow/ask per autonomy |
| other safe read commands | allow only `git status *`, `git branch --show-current`, `ls *`, `rg *`, `find *`; **deny `git log`/`git show`/`git diff`** (history/content) | allow/ask |
| arbitrary shell, installs, deletes | deny | ask/allow per autonomy |
| network fetch / web search / subagents | deny | ask/allow |
| DB migrations / auth / `.github/` / secrets | deny edit; publishing blocked | ask + approval |
| git push / commit / merge / force-push | deny (supervisor publishes) | deny |
| read `.env*`, outside workspace | deny; secret files physically absent | deny |
| docker / sudo / kubectl / cloud CLIs | deny | deny |
| `question` tool | deny | allow when a bridge exists |

`allow` decisions are still subject to the deny list. Deny lists and protected paths are policy config,
not prompt instructions. `OpenCodeConfigWriter` writes the **V2 `permissions` array** (the same
generation as the `/api/session` endpoints), validates that no rule has `effect:"ask"`, and refuses to
start if the V1 `permission` object shape is present.

### Plan approval gate (risk-based)

- Small change (< 5 files, no migration, no protected paths, < 300 diff lines): no plan approval.
- Otherwise: the harness first produces a plan; the supervisor posts it as a `question`/plan approval;
  the human approves before execution. Configurable to always/never per project.

### Budgets and guardrails

- `max_duration_minutes` (default 45), `max_tokens` (1.5M), `max_cost_usd` ($5),
  `max_tool_calls` (100), `max_files_changed` (20), `max_diff_lines` (800).
- At 80% of any budget, post a progress message/notification.
- At 100%, stop the session and mark the ticket `blocked`. Phase 1 releases it with a message; Phase 2
  asks the human whether to continue.
- Verification commands are configured per project (defaults detected from the repo: `package.json`
  scripts, `pom.xml`, `Makefile`).

### Sandbox and isolation

Phase 1 hardens the existing per-agent container:

- Non-root user; workspace volume only; no Docker socket.
- Memory/CPU/pids limits; ephemeral `/tmp`; read-only root where possible.
- Egress allowlist: AI provider proxy, GitHub API (supervisor only), package registries; deny everything
  else by default.
- **Tokenless, shallow clone.** `WorkspaceManager` clones with `--depth 1 --single-branch` and a
  one-shot `git -c http.extraHeader="Authorization: Basic <base64(x-access-token:PAT)>"`; it never
  embeds the token in the URL and does not run `git remote set-url origin <authenticatedUrl>`. Before
  the harness starts, `origin` is removed (or reset to the unauthenticated URL) and
  `WorkspaceSanitizer` verifies `.git/config` contains no credential. Supervisor pushes use the same
  one-shot header. Tests assert the token is absent from `.git/config`, `git remote -v`, workspace
  files, logs and messages.
- **No git history access.** Shallow history plus a shell allowlist that excludes `git log`,
  `git show`, `git diff` and any other history/content command. The supervisor supplies diff facts;
  the agent cannot read a secret from `git show HEAD:.env` or `git log -p`.
- **Workspace sanitiser.** After clone and before server start, remove `.env`, `.env.*` (keep
  `.env.example`), `**/secrets/**`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, and any credential files
  created by tooling. Because the files are physically absent, `read`/`grep`/`cat` cannot leak them.
  `read`/`edit` rules also deny those globs as defence in depth.
- **Dependency bootstrap by the supervisor.** The supervisor runs a bounded install (`npm ci` when a
  lockfile exists, `pip install -r requirements.txt`, or `mvn -q -DskipTests dependency:go-offline`)
  after sanitising and before the harness starts. This keeps installs out of the agent's bash
  allowlist and makes verification runnable on a fresh clone. Installs use the package-registry egress
  allowlist and a timeout; failures are reported before any model call.
- **Provider-key isolation.** The real key never enters the harness config or process. The supervisor
  starts a loopback `ProviderProxy` that holds the key, injects provider-specific auth (`Authorization`
  for OpenAI/Go, `x-api-key` + `anthropic-version` for Claude, `x-opencode-session` for Go/Console),
  and only accepts requests carrying a per-run proxy token (`X-Vibecode-Proxy-Token`, with
  `Authorization: Bearer <token>` or Claude `x-api-key: <token>` fallbacks). OpenCode is pointed at
  `http://127.0.0.1:<proxy-port>/v1` with a dummy key. If the pinned build supports overriding the
  built-in provider `baseURL`, use it; otherwise use the custom OpenAI-compatible provider and let the
  proxy add the session header. The proxy is bound to 127.0.0.1, rejects non-loopback peers, and is
  stopped after the run.
- **Output redaction.** `SecretRedactor` removes known secret values (PAT, provider key, server
  password, proxy token) and token-shaped patterns (`ghp_`, `github_pat_`, `oc_sk_`, `sk-`, `Bearer`)
  from every posted message, event payload, log line and exception. A fake output test proves a token
  is redacted before posting.
- **Protected paths.** Phase 1 blocks publishing if the diff touches `.env*`, `.github/workflows/**`,
  `**/secrets/**`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, `.git/**`,
  `backend/src/migrations/**`, `backend/src/middleware/auth*`,
  `backend/src/services/UserService.js`, or `backend/src/validators/auth*`. The sanitizer also passes
  its full removed-path list to `PublishingGuard`; any diff touching a removed path is blocked even if
  that path is outside the protected globs. Removed files are never restored. Phase 1 has no human
  gate, so these changes fail and the ticket is released; Phase 3 replaces the hard block with
  plan/action approval.
- Secrets scrubbed from event payloads before persistence; log redaction.

Phase 3 may add a nested per-ticket container if stronger isolation is required.

### Provider mapping

| Planner provider | OpenCode config (all via `ProviderProxy`) |
|---|---|
| `opencode` (Console/Go key) | built-in `opencode` provider with overridden `baseURL`, model `opencode/<model-id>`; proxy adds `x-opencode-session` |
| `claude` | native Anthropic provider with `baseURL` = proxy; proxy injects `x-api-key` + `anthropic-version` |
| `openai` | custom/OpenAI provider with `baseURL` = proxy; proxy injects `Authorization` |
| `generic` | custom OpenAI-compatible provider with `baseURL` = proxy; proxy injects `Authorization` |

For `oc_sk_...` Console/Go keys, **always use the built-in `opencode` provider**. This is what makes
OpenCode-only free-tier models available and what sends the `x-opencode-session` header automatically.
A custom OpenAI-compatible provider is for third-party endpoints, not for Console/Go keys.

### OpenCode Go / Console model caveats

Verified 2026-10-31 with the project's Go key:

- The Go model list contains 28 models. Free/unlimited-for-now entries include `beam-free`,
  `iceman-contributor-free`, `muse-spark-1.2-contributor`, `muse-spark-1.3-contributor`.
- `beam-free` works from a direct OpenAI-compatible call (with `x-opencode-session`).
- `iceman-contributor-free` returns an upstream error until the workspace enables
  **“Allow paid endpoints that train on request data.”** Treat it as a training-data opt-in.
- `big-pickle` is not in the Go list; it is a Console free-tier model. Free-tier chat models are
  documented as available only from within OpenCode, so the harness may expose it through the
  built-in provider, but this is not guaranteed and must be verified per pinned version.
- “Unlimited” means the promotional free model has no monthly dollar cap; it is time-limited,
  subject to abuse monitoring, and not an SLA. Go paid models still have monthly usage limits.

Default for real tickets: a paid Go coding model (`deepseek-v4.1-flash`, `glm-5.3`,
`kimi-k2.7-code`). Use free models for experiments and avoid sending sensitive data to
training-enabled models.

**Benchmark result (2026-10-31).** Both free models were run through the real OpenCode CLI on the same
task in separate GTD clones: add `GET /api/v1/items/random` with validation and tests. Both passed the
project suite (82 tests) and the independent 5-case audit. Beam Free was faster (64.8s vs 103.5s),
produced fewer output tokens (2,267 vs 3,385), and wrote a stronger isolation test in a dedicated test
file. Decision for the free worker pool:

- **Primary:** `opencode-go/beam-free` — no training-data opt-in, 30-day retention, faster.
- **Backup:** `opencode-go/iceman-contributor-free` — only for public/non-sensitive repos; trains on
  request data and requires the privacy opt-in. **Currently disabled by the operator**; re-enable only
  with an explicit privacy decision. If it is unavailable, fall back to a paid Go model rather than
  another training-enabled model.
- **Escalation:** move complex/blocked tickets to a paid Go model rather than retrying indefinitely on
  a free model.

This is a single-task sample; re-evaluate on the first 3–5 real tickets before treating the ranking as
permanent.

### Free worker nodes (Iceman / Beam) — operational caveats

It is technically possible to run multiple planner worker agents against a free Go model, sharing one
key. Before doing that:

- **Privacy opt-in is workspace-wide and persistent.** Enabling “paid endpoints that train on request
  data” unlocks Iceman/Muse contributor models, but also means those requests may be used for training.
  Only use this for public or non-sensitive repositories. Never send secrets, private customer code or
  credentials to a training-enabled model.
- **“Unlimited” is promotional.** It is time-limited, subject to abuse monitoring and may be throttled.
  It is not an SLA and not suitable for guaranteed throughput across many nodes.
- **Model capability must be proven.** A free/contributor model may not support long tool loops, large
  context or reliable tool calling. Run a controlled harness test on a scratch repo before assigning it
  to real tickets.
- **Use Beam Free first if privacy matters.** `beam-free` does not train on requests (30-day retention),
  worked in the smoke test, and is the safer free option. Iceman is for public-data experiments only.
- **Paid Go models are still the default for production work.** Free nodes are best for experimentation,
  documentation, low-risk chores and load tests.

The provider key is decrypted in the supervisor, held only by `ProviderProxy`, and never written to a
config or logged. The harness receives a per-run proxy token. The model is configurable per project
and per policy.

### Multi-agent evolution (Phase 3)

Use OpenCode agent definitions/subagents:

1. **Architect** — produces/validates 01–04 and the implementation plan; no edits.
2. **Builder** — implements and tests.
3. **Reviewer** — reviews the diff, runs tests, files findings.
4. **Fixer** — addresses review findings.

The supervisor orchestrates the handoffs and stores each as a session; human gates remain risk-based.

---

## Database Changes

### New tables

```sql
CREATE TABLE agent_sessions (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  harness VARCHAR(32) NOT NULL DEFAULT 'opencode',
  external_session_id TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting','running','waiting_human','verifying','publishing','completed','failed','aborted')),
  workspace TEXT,
  provider_type VARCHAR(50),
  model VARCHAR(120),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  tokens_in BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  resumed_from_session_id BIGINT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  resume_mode VARCHAR(16) CHECK (resume_mode IN ('continue','fresh')),
  metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_agent_sessions_ticket ON agent_sessions(ticket_id, started_at DESC);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
-- Idempotency: replayed event batches cannot create a second row for the same harness session.
CREATE UNIQUE INDEX uq_agent_sessions_external
  ON agent_sessions(ticket_id, external_session_id)
  WHERE external_session_id IS NOT NULL;

CREATE TABLE agent_events (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, seq)
);
CREATE INDEX idx_agent_events_session ON agent_events(session_id, seq);

CREATE TABLE ticket_questions (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  session_id BIGINT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('question','permission','plan_approval')),
  external_id TEXT,
  prompt TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','answered','expired','cancelled')),
  answer JSONB,
  answered_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_ticket_questions_ticket ON ticket_questions(ticket_id, asked_at DESC);
CREATE INDEX idx_ticket_questions_pending ON ticket_questions(status) WHERE status = 'pending';
-- Idempotency: the same OpenCode form/permission cannot be inserted twice by event replay.
CREATE UNIQUE INDEX uq_ticket_questions_external
  ON ticket_questions(session_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES ticket_questions(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE agent_policies (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  autonomy VARCHAR(20) NOT NULL DEFAULT 'standard'
    CHECK (autonomy IN ('supervised','standard','autonomous')),
  require_plan_approval BOOLEAN NOT NULL DEFAULT FALSE,
  max_duration_minutes INTEGER NOT NULL DEFAULT 45,
  max_tokens BIGINT NOT NULL DEFAULT 1500000,
  max_cost_usd NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  max_tool_calls INTEGER NOT NULL DEFAULT 100,
  max_files_changed INTEGER NOT NULL DEFAULT 20,
  max_diff_lines INTEGER NOT NULL DEFAULT 800,
  allow_network BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_commands JSONB NOT NULL DEFAULT '[]',
  denied_paths JSONB NOT NULL DEFAULT '["**/.env*","**/secrets/**"]',
  verification_commands JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Column additions

```sql
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS agent_session_id BIGINT
  REFERENCES agent_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_messages_session ON ticket_messages(agent_session_id);

-- Heartbeat metadata so the UI can find the active session without an extra lookup.
ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS agent_session_id BIGINT
  REFERENCES agent_sessions(id) ON DELETE SET NULL;
ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS current_tool VARCHAR(80);
ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tokens_in BIGINT NOT NULL DEFAULT 0;
ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tokens_out BIGINT NOT NULL DEFAULT 0;
ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_session ON agent_heartbeats(agent_session_id);
```

`POST /agents-status/:id/heartbeat` accepts the new optional fields. `PATCH /agent-sessions/:id`
updates the same heartbeat row, so the session is the source of truth and the heartbeat is a
projection. Existing agents that send only the old fields remain compatible.

---

## API Design

### Agent-facing (X-API-Key, `verifyTokenOrAgent`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/agent-sessions` | Create a session for a ticket |
| PATCH | `/api/v1/agent-sessions/:id` | Status/heartbeat/usage updates |
| POST | `/api/v1/agent-sessions/:id/events` | Append event batch (max 50) |
| POST | `/api/v1/agents-status/:id/heartbeat` | Heartbeat; accepts optional session/tool/token/cost fields |
| POST | `/api/v1/tickets/:ticketId/questions` | Ask a question / request permission |
| GET | `/api/v1/tickets/:ticketId/questions/:questionId` | Poll for answer/timeout |
| POST | `/api/v1/tickets/:ticketId/questions/:questionId/cancel` | Cancel a question |

### Human-facing (JWT + permissions)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/tickets/:ticketId/questions` | List questions for a ticket |
| POST | `/api/v1/tickets/:ticketId/questions/:questionId/answer` | Answer a pending question |
| GET | `/api/v1/agent-sessions?ticketId=&status=&limit=` | List sessions for a ticket/agent (UI discovery) |
| GET | `/api/v1/tickets/:ticketId/agent-sessions` | Convenience alias for the ticket Agent tab |
| GET | `/api/v1/agent-sessions/:id` | Session summary |
| GET | `/api/v1/agent-sessions/:id/events?after=` | Paginated transcript |
| GET | `/api/v1/notifications?unread=true` | Notification list |
| PATCH | `/api/v1/notifications/:id/read` | Mark one read |
| POST | `/api/v1/notifications/read-all` | Mark all read |
| GET/PUT | `/api/v1/projects/:id/agent-policy` | Autonomy/budget/verification settings |

Response envelopes remain `{ success, data }` / `{ success:false, error }`.

### Phase side effects

**Decision: `phase` is the source of truth; `status` is derived and updated in the same transaction.**
`PhaseService.transition` already writes both. Phase 1 adds `backlog` as an explicit phase and routes
every lifecycle change through `TicketLifecycleService`, which updates assignment, `phase`, `status`
and `ticket_phases` in one transaction.

| Action | Phase | Status | Notes |
|---|---|---|---|
| Pickup | `backlog → in_progress` | `in_progress` | assignment set in the same transaction |
| Agent asks question / permission / plan approval (Phase 2) | `in_progress → blocked` (or `planning → blocked` for plan approval) | `in_progress` | status stays `in_progress` while blocked |
| Human answers (Phase 2) | `blocked → in_progress` (`blocked → plan_approved` for plan approval) | `in_progress` | |
| Verification passes + PR created | `in_progress → review` | `review` | no drift |
| Failure after retries (Phase 2) | `in_progress → blocked` | `in_progress` | + question/notification |
| Failure in Phase 1 (no human loop) | `in_progress → backlog` | `backlog` | redacted message; release |
| Release / cancel | `backlog` | `backlog` | clears assignment and lock atomically |

`PhaseService.ALLOWED_TRANSITIONS` gets `backlog: ['in_progress']`, `in_progress: [..., 'backlog']`,
`blocked: ['in_progress','backlog']`, `review: [...,'backlog']`, and `PHASE_TO_STATUS.backlog = 'backlog'`.
It also accepts the legacy phases as pickup sources: `draft`, `planning`, `plan_approved` and
`assigned` can transition to `in_progress` (the lifecycle normalises them).
`BACKLOG_COMPATIBLE_PHASES` must include `backlog` alongside `draft`, `planning`, `plan_approved` and
`assigned`, so `isBacklogCompatible()` agrees with the new lifecycle.
`TicketService.pickUpTicket/releaseTicket` delegate to `TicketLifecycleService`; direct status-only
updates are no longer used by the harness. Add `planning → blocked` and `blocked → plan_approved` for
the optional plan gate in Phase 2.

**Backlog compatibility.** Migration 018 maps every `status='backlog'` to `phase='draft'`, and
`Ticket.create()` currently inserts `'draft'`. Phase 1 therefore does all three:
1. `045_backfill_backlog_phase.sql` sets `phase='backlog'` for existing backlog/draft rows (data-only,
   idempotent, with rollback);
2. `Ticket.create()` inserts `phase='backlog'` for new backlog tickets;
3. `TicketLifecycleService.pickUp()` explicitly accepts `draft`/`planning`/`plan_approved`/`assigned`
   as legacy sources so an un-backfilled ticket still works.

A regression test covers a pre-existing `phase='draft'` ticket.

---

## Frontend Design

- **Notification bell** in `App.vue` / global nav: unread count, dropdown, mark read, deep links.
- **Agent Questions** page (`/agent-questions`) with pending questions across projects.
- **TicketDetail**:
  - new **Agent** tab: current/recent session from `GET /tickets/:ticketId/agent-sessions`
    (fallback `GET /agent-sessions?ticketId=`), status, current step/tool, elapsed time, tokens/cost,
    timeline, diff summary.
  - question card when pending: prompt, options, custom answer, answer button, expiry.
  - live polling every 5s while pending; stop when idle.
- **PhaseBlocked** view: embed the same question card.
- **Project settings**: Autonomy tab/section with policy fields and verification commands.
- **Toasts** for new questions/completions; accessible labels and keyboard support.
- Polling (10s) for MVP; SSE endpoint can be added later without changing the UI contract.

---

## Security Considerations

- Agent endpoints are API-key authenticated and scoped to the agent's project.
- Human endpoints use JWT + project permissions; question answers are validated.
- **GitHub token:** never written to `.git/config` or the workspace; clone/push use a one-shot
  `http.extraHeader` from the supervisor. `WorkspaceSanitizer` verifies the workspace is clean.
- **Provider key:** only in the supervisor's `ProviderProxy`; the harness holds a dummy per-run key.
- **Workspace:** `.env*` (except `.env.example`), `**/secrets/**`, `*.pem`, `*.key`, `id_rsa*` are
  removed before the harness starts. `read`/`edit` permission rules deny them as defence in depth.
- **Output:** `SecretRedactor` runs before anything is posted or logged; tests use fake tokens.
- `.env*`, external directories and secret paths are denied by permission rules and the supervisor.
- Publishing is supervisor-only; branch names validated; no main commits, no force pushes.
- Phase 1 has no `ask`: safe bash allowlist + deny list, no deadlock, unexpected permission → reject.
- Protected paths (auth, migrations, workflows, secrets) block publishing in Phase 1.
- Prompt injection from repository content is treated as untrusted; system prompt and policies both enforce.
- Event payloads are truncated and redacted; retention 30 days.
- Rate limits on answer/notification endpoints.

---

## Testing Strategy

| Layer | Tool | What it proves |
|---|---|---|
| Agent unit | JUnit | Prompt builder, policy matrix, event mapping, diff/protected paths |
| Agent contract | JUnit + fake HTTP/SSE server | OpenCode client behaviour, forms, permissions, idle/error |
| Backend unit | Jest | Questions/sessions/notifications/policies |
| Backend integration | Jest + real PG | ask→answer→resume, phase changes, isolation |
| Bash integration | curl | HTTP lifecycle with real containers |
| Frontend unit/component | Vitest/Cypress | Bell, question card, agent tab, policy settings |
| E2E | Cypress + fake harness | Full human answer flow |
| Live smoke (manual) | Real provider | One real ticket, budget-capped |

CI must never call a real model. The fake harness server replays scripted event sequences.

---

## Risks and Edge Cases

### Risks

- **OpenCode API drift** → pin version; contract tests; adapter layer.
- **Cost runaway** → budgets, 80% warnings, hard stop, human resume.
- **Prompt injection / malicious repo** → sandbox + deny lists + protected-path publishing block
  (human approval in Phase 3).
- **Secrets leakage** → tokenless clone, workspace sanitizer, provider proxy, output redaction;
  tests assert no PAT/key in `.git/config`, workspace, logs, events or messages.
- **Question starvation** → notifications, expiry, escalation, unread bell.
- **Long-running sessions** → heartbeat, wall-clock cap, park/resume.
- **Agent crash** → orphan reconciliation; unanswered questions remain; retry policy.
- **Toolchain gaps** → per-project verification commands; image includes common runtimes.
- **Verification flakiness** → record command/output; allow retry; human override with reason.
- **Multi-tenant isolation** → one container per agent; project-scoped data; no shared workspaces.

### Edge cases

- Human answers just as the question expires → answer endpoint wins if the row is still pending; otherwise 409.
- Agent asks a question then crashes → question remains pending; next agent run reconciles and can resume or cancel.
- Two agents pick the same ticket → existing pickup is atomic; supervisor must tolerate failure and skip.
- Diff is empty → no PR; post "no changes" and release (Phase 1); ask in Phase 2.
- Protected file changed → block publishing and release (Phase 1); ask/approve in Phase 3.
  Never push.
- Verification fails after max retries → no push; ticket blocked with logs.
- Answer arrives while agent is offline → stored and marked consumed only when a new session starts.
  **Resume is a fresh session in the same workspace**, not an assumption that the old process is alive:
  `agent_sessions.resume_mode='fresh'`, `resumed_from_session_id` points at the prior session, and the
  resume prompt contains the ticket, the answered question, the current diff/status and a summary of
  the prior session. If the pinned server still exposes the original session and it is alive, the
  supervisor may use `resume_mode='continue'`; otherwise it always starts fresh.
  The workspace is kept until the question is answered or a TTL expires; if it was cleaned, the
  supervisor re-clones the ticket branch and re-applies the saved patch artifact before starting the
  fresh session. The resume therefore never depends on process state.
- Provider 401/429 → retry with backoff, then block with a human notification.
- Server fails to start → fail fast, release ticket, no PR.
- Workspace path collisions → include agent id + ticket id + random suffix.

---

## Alternative Designs Considered

### Alternative 1: Custom tool loop in Java
- **Pros**: no external harness; full control.
- **Cons**: enormous scope; weak parity; months of work.
- **Decision**: rejected for Phase 1; `HarnessClient` keeps the door open.

### Alternative 2: `opencode run` one-shot
- **Pros**: simple.
- **Cons**: no durable questions/permissions/resume.
- **Decision**: rejected.

### Alternative 3: Keep JSON protocol and add file contents
- **Pros**: smallest change.
- **Cons**: context explosion; no tests; no iteration.
- **Decision**: rejected.

---

## Pending Scope Items to Present to User

See `01_ARCHITECT_REQUIREMENT.md` — the same ten items apply. They are presented in the PR #101
description and in a dedicated PR comment; the `User Notified` column is updated to `Yes (PR #101)`.

---

## Specification Generation

Phase 1 is specified in `04_SPECIFICATION.md`. Phase 2 (questions/notifications/UI) and Phase 3
(policies/multi-agent) require their own 04 documents once Phase 1 is validated.
