# DREAM.md — Vision, Gap Analysis & Implementation Plan

> The user should focus on planning, not typing in a terminal.
> Every AI coding tool today assumes you use a terminal, read output,
> and keep interacting — that's not planning, it's a chore.
>
> Computers spend most of their time idling. They could be building,
> planning, scheduling — putting your own hardware to work solving
> your problems while you focus on what matters.
>
> This system is born from that idea: the user plans, tracks progress,
> approves changes, and the machine does the rest.

---

## The Philosophy

A human's role in software development should be:
1. **Plan** — decide what to build and why
2. **Review** — verify the result is correct
3. **Approve** — green-light changes
4. **Repeat**

Everything else — coding, testing, committing, deploying, provisioning — should be handled by autonomous agents running on infrastructure the user controls. The interface is a guided step-by-step flow, not a terminal. If an agent gets stuck, it requests human input through the same UI.

The system is an all-in-one platform covering: feature planning, ticket scheduling, progress tracking, code review, and deployment.

### Why Not a Terminal?

Every AI coding tool today — Antigravity, Claude Code, OpenCode, Cursor agent mode — is a faster terminal, a better terminal, a multiplexed terminal. But still a terminal: you type, you read output, you react, you repeat. The feedback loop has gotten faster, but it hasn't changed shape. It's still a chat between a developer and an LLM, mediated by keystrokes and scrollback buffers.

That works for developers who already know what they want. It does not work for:

- A **product manager** who needs to describe a feature and see it built
- A **secretary** who needs to update a website's pricing page
- A **domain expert** who knows what the software should do but not how to make it do that
- A **developer** who wants to stay at the architectural level instead of context-switching into every file

This system replaces the terminal feedback loop with a **planning → approval** loop:

| Terminal loop | This system |
|---------------|-------------|
| Type a prompt | Describe intent via a ticket |
| Read output | See status update on a dashboard |
| Spot a bug, type a fix | Reject the PR, agent fixes it |
| Debug a crash, read a traceback | Agent asks for input, you answer in the UI |
| Remember to lint/test/push | Agent does it automatically |
| Context-switch into 5 files | You never leave the kanban board |

The abstraction is the **ticket**, not the file tree. You don't care which file the bug is in — you care that the bug is fixed and the PR is open. The feedback is a dashboard with green/red indicators, not a scrollback buffer.

Good design abstracts away mechanics and surfaces intent. Git abstracts away diff/patch mechanics. Docker abstracts away dependency installation. This system abstracts away the terminal entirely — replacing it with what the human actually adds value on: deciding what to build, reviewing the result, and approving the change.

The goal is not a developer tool that does more. The goal is a system that makes software development accessible to anyone who can describe what they want.

### Idle Compute as a Resource

Computers spend most of their time doing nothing.

A typical developer machine is actively used for 4–6 hours a day. The other 18–20 hours it sits idle — overnight, during meetings, while you're context-switching, while you're thinking. Even during active use, the CPU is rarely above 10–20% for more than a few seconds at a time. That's billions of wasted cycles per day per machine.

Now add a GPU. Most gaming-capable GPUs sit idle 22+ hours a day. The same GPU that can run a 34-billion-parameter model locally is running a screensaver.

This planner reframes that waste as a resource:

1. You describe what you want via the planner UI (ticket → planning → assign)
2. Your own machine picks up the ticket when it would otherwise be idle
3. It runs an agent worker in the background, using your local AI model (Ollama, vLLM) to plan, code, test
4. The agent commits, pushes, opens a PR
5. You come back to a finished feature, review it, approve it

The machine isn't a tool you actively drive anymore. It's a **worker that reports to you**. You're the product manager. Your computer is the engineering team.

This scales horizontally too. If one machine isn't enough:
- Your **laptop** runs the planner UI + backend (lightweight)
- Your **desktop with a GPU** runs the AI model server (Ollama/vLLM)
- Your **homelab or NAS** runs multiple agent workers (clone repos, write code, run tests)
- Your **spare laptops** (everyone has one in a drawer) join the pool as worker nodes

All of them would otherwise be idle. Together they form a private build farm that costs nothing to run because you already own the hardware and pay for the electricity anyway.

This is the logical endpoint of the "why not a terminal" philosophy: if the human doesn't need to be at the keyboard for the machine to do useful work, then the machine should work whether the human is at the keyboard or not.

---

## Template Design: The Missing Layer

Small models (7B–34B) produce correct code when the specification is detailed enough that they don't need to infer anything. The current three templates (Architect, Technical, Simple) are designed for human readability — they capture *intent* but not the *specification* a model needs to produce reliable output.

### What Current Templates Contain

**Architect** (4 files): Pre-implementation checklist, requirement with scope/assumptions/decisions, design with alternatives and data flow, implementation plan with actions/rollback/files changed. All prose with `TBD` placeholders.

**Technical** (3 files): Functional/non-functional requirements, data model diagrams, API design, implementation steps. More concrete than Architect but still at the API/DB level, not the code level.

**Simple** (1 file): A checkbox task list. No structure at all.

### What a Small Model Actually Needs

A 7B model given "create a login page" will produce something that looks like a login page but misses half the edge cases. Same model given "create Login.vue with these exact imports, these exact state variables, this exact function signature, these exact template elements" will produce exactly that, correctly.

The missing layer is a **Specification** — a file that sits between the planning docs (what to build) and the code (how to build it). It encodes exact file paths, function signatures, imports, test expectations, and edge cases. The small model doesn't make any architecture decisions — those are already made by the human (or a larger model) in the Architect/Technical templates. The small model just produces code that matches the spec.

### Template Layering

| Layer | Template | Purpose | Read By | When |
|-------|----------|---------|---------|------|
| 1 | Architect | Human thinks through what to build | Human + large model reviewer | Planning phase |
| 2 | Technical | Design the API, DB, data flow | Human + large model reviewer | Planning phase |
| 3 | **Specification** (NEW) | Encode exact file operations for the agent | Small model (agent) | Before agent starts |
| 4 | Simple | Small tasks that don't need full planning | Human + agent | Quick tickets |

The flow is: human fills Architect + Technical → a large model (or human) generates the Specification from them → the small model agent consumes the Specification and writes code. The Specification is the contract between planning and execution.

### Updated Architect Template

The current Architect template has good bones but each file lacks structure. Here is the redesigned version:

#### 00_ARCHITECT_CHECKLIST.md (Pre-Implementation)

Current problems:
- Generic items like "Requirements are clear" that nobody checks
- No existing infrastructure audit
- No dependency mapping
- No env var audit

Redesigned structure:

```markdown
# 00_ARCHITECT_CHECKLIST.md

**Status**: planned
**Date created**: YYYY-MM-DD
**Feature scope**: Frontend | Backend | Both

## Pre-Implementation Checklist

### Planning
- [ ] Acceptance criteria are specific and testable (not "it works")
- [ ] Out-of-scope items explicitly documented
- [ ] All design decisions have documented options (not just the chosen one)
- [ ] "Unknown unknowns" identified — things that could change the approach

### Existing Infrastructure Audit
- [ ] Backend API checked — does the route/controller/service already exist?
- [ ] Frontend API client checked — does the API call already exist in `frontend/src/api/`?
- [ ] Frontend UI checked — does the view/component already exist?
- [ ] Router checked — does the route already exist in `router/index.ts`?
- [ ] Database schema checked — do the tables/columns already exist?
- [ ] Migration checked — does a migration need to be added?
- [ ] Existing patterns identified — what style does surrounding code use?

### Dependency Analysis
- [ ] All new dependencies listed (npm packages, system deps, external APIs)
- [ ] All existing dependencies that will be affected listed
- [ ] Breaking changes identified (API contract changes, DB migration)

### Configuration Audit
- [ ] All new env vars documented with defaults and descriptions
- [ ] All new config files documented
- [ ] Feature flags considered (can this be toggled off?)

### Testing Strategy
- [ ] Unit test files identified per changed module
- [ ] Integration test scope defined
- [ ] Manual test scenarios enumerated

### Rollback Readiness
- [ ] Database migration is reversible (has _rollback.sql)
- [ ] API change is backward-compatible or versioned
- [ ] Deploy order is documented (migration first, then code)

## When to Ask the User
- Ambiguous acceptance criteria
- Scope change discovered during audit
- Conflicting requirements
- UI placement decisions
- Unclear error handling strategy
```

#### 01_ARCHITECT_REQUIREMENT.md (Requirement)

Redesigned structure:

```markdown
# 01_ARCHITECT_REQUIREMENT.md

**Status**: planned
**Date created**: YYYY-MM-DD
**Feature scope**: Frontend | Backend | Both

## Problem Statement
Describe the problem in one paragraph. What user need does this address?

## Scope
- **In scope**: List exactly what this ticket covers
- **Out of scope**: List what this ticket explicitly does NOT cover

## Acceptance Criteria
Each criterion must be testable (pass/fail, not subjective).

- [ ] Criterion 1 — specific behavior, not implementation detail
- [ ] Criterion 2 — edge case covered

## Known Unknowns
Things that could change the approach if they turn out differently:
- **Unknown 1**: What we don't know, and how to resolve it
- **Unknown 2**: What we don't know, and how to resolve it

## Decisions Required
Each decision has options so the implementer doesn't have to guess.

1. **Question**: How should we handle X?
   - Option A: Description, tradeoffs
   - Option B: Description, tradeoffs
   - Recommendation: Option A (reason)

## Impact Analysis
| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/Foo.js` | MODIFY | Add bar() method |
| `database` | NEW MIGRATION | Add `baz` column to `tickets` |
| `frontend/src/views/Bar.vue` | CREATE | New page for baz management |

## Dependencies
- **This ticket depends on**: TICKET-123 (must be done first)
- **Depends on this**: None

## Performance Considerations
- Expected QPS on new endpoint
- Data size expectations
- Caching strategy if any
```

#### 02_ARCHITECT_DESIGN.md (Design)

Redesigned structure:

```markdown
# 02_ARCHITECT_DESIGN.md

**Status**: planned
**Date created**: YYYY-MM-DD

## Current State
What exists today. File paths, relevant code snippets, current behavior.

## Proposed Solution
### Approach
Describe the approach in 2-3 paragraphs. Include code patterns, not just prose.

### Data Flow
Describe the flow from trigger to completion:
```
User clicks button → FE calls POST /api/v1/foo → service
validates → DB insert → FE updates store → UI re-renders
```

### File-Level Impact
| File | Action | What Changes |
|------|--------|-------------|
| `backend/src/routes/foo.js` | MODIFY | Add POST /foo endpoint |
| `backend/src/services/FooService.js` | MODIFY | Add createFoo() method |
| `frontend/src/api/foo.js` | MODIFY | Add createFoo() API call |
| `frontend/src/views/FooList.vue` | MODIFY | Add create button + form |

### Error Handling Strategy
- What can go wrong at each layer
- What the user sees for each error type
- Retry vs. fail-fast decisions

### Alternatives Considered
- **Alternative A**: Chosen because ___. Rejected because ___.
- **Alternative B**: Considered but rejected because ___.

## Security Considerations
- Authentication required for new endpoints
- Authorization checks (which roles can do what)
- Input validation (what fields, what constraints)
- Rate limiting needs

## Database Changes
- New tables with column types and constraints
- New columns with defaults and nullability
- Indexes needed
- Migration strategy (data backfill if needed)

## API Contract
- New/Changed endpoints with request/response shapes
- Status codes per outcome
- Error response format
```

#### 03_ARCHITECT_IMPLEMENTATION.md (Implementation)

Redesigned structure:

```markdown
# 03_ARCHITECT_IMPLEMENTATION.md

**Status**: planned
**Date created**: YYYY-MM-DD
**Effort**: Small | Medium | Large

## Purpose
One-sentence summary of what this implementation achieves.

## Implementation Order
Steps must be executed in this order (dependencies listed):

1. **Step 1**: Short description — file path
   - Sub-step
   - Sub-step
   - *Depends on*: nothing

2. **Step 2**: Short description — file path
   - Sub-step
   - Sub-step
   - *Depends on*: Step 1

## Per-File Action Plan

### `backend/src/services/FooService.js` (MODIFY)
- Add `createFoo(data)` method
- Signature: `async createFoo(data: CreateFooInput): Promise<Foo>`
- Logic: validate → insert into DB → return created record
- Error cases: duplicate key → 409, validation fail → 400

### `frontend/src/api/foo.js` (MODIFY)
- Add `createFoo(data)` function
- Signature: `export async function createFoo(data: CreateFooInput): Promise<Foo>`
- HTTP: POST /api/v1/foo with JSON body

## Migration Plan
1. Run migration 018_add_foo_table.sql
2. Verify columns and constraints
3. Rollback: 018_add_foo_table_rollback.sql

## Test Plan

### Unit Tests
| File | Test | What It Covers |
|------|------|----------------|
| `FooService.test.js` | creates a foo successfully | Happy path |
| `FooService.test.js` | rejects duplicate name | Unique constraint |
| `FooService.test.js` | rejects missing required field | Validation |

### Integration Tests
- What to test against real DB
- What curl commands to run

## Rollback Steps
1. `git revert <commit>`
2. `npm run db:rollback` (migration 018)
3. Verify frontend shows no errors
```

### New: Specification Template (04_SPECIFICATION.md)

This is the **new** file that bridges planning to execution. It's added as the 5th file in the Architect template, or as a standalone 1-file template for smaller tasks.

```markdown
# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: Architect + Technical templates
**Target model**: 7B–34B local model (e.g., CodeLlama, Qwen, DeepSeek-Coder)
**Date**: YYYY-MM-DD

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create,
modify, or delete any file not listed here.

### CREATE: `frontend/src/components/Login.vue`

**Imports** (exact):
```
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
```

**State variables** (exact names and types):
```
email: ref('')                  → bound to email input via v-model
password: ref('')               → bound to password input via v-model
error: ref<string | null>(null) → displayed when login fails
loading: ref(false)             → disables submit button while true
```

**Functions** (exact signatures):
```
async function handleSubmit(): Promise<void>
  1. if (!email.value || !password.value) return (form validation)
  2. loading.value = true
  3. error.value = null
  4. try:
       await authStore.login(email.value, password.value)
       router.push('/dashboard')
     catch (err):
       error.value = err.message || 'Login failed'
     finally:
       loading.value = false
```

**Template structure** (exact hierarchy):
```
<form @submit.prevent="handleSubmit">
  <div>
    <label for="email">Email</label>
    <input id="email" v-model="email" type="email" required />
  </div>
  <div>
    <label for="password">Password</label>
    <input id="password" v-model="password" type="password" required />
  </div>
  <button type="submit" :disabled="loading">
    {{ loading ? 'Signing in...' : 'Sign In' }}
  </button>
  <p v-if="error" class="error">{{ error }}</p>
</form>
```

**Styling**: Use scoped CSS, no external classes. Form centered, inputs full-width, error text red.

### MODIFY: `frontend/src/stores/auth.js`

**Add method**: `async login(email: string, password: string): Promise<void>`
```
Logic:
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!response.ok) throw new Error((await response.json()).error)
  const data = await response.json()
  this.setToken(data.token)
  this.setUser(data.user)
  this.setPermissions(data.permissions || [])
```

**Position in file**: Add after `logout()` method, before `isAuthenticated()`.

### MODIFY: `frontend/src/api/client.js`

**No changes needed** for this ticket.

## Test Expectations

### Login.vue
```
✓ Renders email input, password input, submit button
✓ Shows error message when login fails (mock API returns 401)
✓ Calls authStore.login with correct email and password on submit
✓ Redirects to /dashboard on successful login
✓ Disables submit button while loading
✓ Does not submit if email or password is empty
```

### auth store login()
```
✓ Stores token in localStorage under 'vibecode_token'
✓ Stores user in localStorage under 'vibecode_user'
✓ Throws readable error on non-ok response
✓ Stores permissions if returned
```

## Edge Cases to Handle
1. **Network error**: fetch throws → catch block shows "Unable to connect. Please try again."
2. **Already logged in**: component checks `authStore.isAuthenticated()` on mount → redirect to /dashboard
3. **Token expiry after login**: Not handled in this ticket (separate concern)
4. **Double submit**: loading flag prevents multiple simultaneous submissions
5. **Browser autofill**: No special handling needed — browser handles it natively

## Existing Code Patterns to Follow
- Use `<script setup>` syntax (Composition API), not Options API
- Import from `@/stores/auth` not relative paths
- Error messages in English, stored as strings not translated (i18n not set up yet)
- No TypeScript in .vue files (project uses .ts for stores/API, .vue files are plain JS)
```

### How This Changes the Template System

| Change | What |
|--------|------|
| **Architect template** | Updated from 4 files to 5 (adds 04_SPECIFICATION.md). All 4 old files redesigned with more structure. |
| **Technical template** | Unchanged for now (can get Specification added later). |
| **Specification template** | New standalone 1-file template for small tasks that don't need full Architect planning. Contains the same structure as 04_SPECIFICATION.md. |
| **Simple template** | Unchanged — still a checkbox list for the smallest tasks. |

### Generation Flow

The Specification file is filled by one of:
1. **A human** — after filling Architect/Technical, the human writes the spec
2. **A large model** — the Architect/Technical template files are fed to Claude/GPT-4, which generates the Specification
3. **Both** — large model generates a draft, human reviews and corrects

The agent (small model) never sees the Architect or Technical templates. It only sees the Specification. This means:
- The small model gets the exact information it needs, with nothing extra to confuse it
- The human's planning notes remain private (not sent to a cloud model via the agent)
- The Specification can be versioned independently — you can tweak the spec and re-run without re-planning

### Update TemplateService.js

The three files in `backend/src/services/TemplateService.js` that need updating:
1. **Architect static getter** — add `04_SPECIFICATION.md` to the file list, add `getSpecificationContent()` method
2. **Architect file content methods** — rewrite all four existing methods with the redesigned structures above
3. **Specification static getter** — add a new `SPECIFICATION_FILES` definition (1 file), add `getSpecificationTemplateContent()` method
4. **Template metadata** — add new template definition to the static lookup

---

## What Exists (Verified Against Code)

### Backend (`backend/src/`)

| File / Area | What It Does |
|-------------|--------------|
| `index.js` | Express entry; exports app (for tests), skips listen in `NODE_ENV=test` |
| `api/routes.js` | Unversioned routes: /health, /version, /docs, /metrics, /auth/*. Mounts /api/v1/* |
| `api/v1/index.js` | Mounts 18 route modules under /v1 |
| `services/AgentService.js` | Agent CRUD, API key generation (`ak_` prefix), action logging ($0.05 fixed cost), daily rate limit (100/day) |
| `services/TicketPlanningService.js` | Versioned planning docs per ticket, template application, planning status workflow |
| `services/TicketService.js` | Ticket CRUD, agent pickup/release, orphan recovery (60min stale), comments |
| `services/ApprovalService.js` | Request/approve/reject for tickets in `review`. Approve → auto-transitions to `done` |
| `services/GitHubService.js` | Connect repos, create branches, create/delete PRs. Token encryption via `utils/crypto` |
| `services/TemplateService.js` | **Currently**: 3 built-in templates (Architect/Technical/Simple) + custom project templates with JSONB file_definitions. **Needs**: Add Specification as 4th built-in, redesign Architect with better structure per file above. |
| `services/ProjectService.js` | Project CRUD, membership (stub — `updateMembership` doesn't differentiate add/remove/change role) |
| `services/PermissionService.js` | 26 permissions across 4 roles, in-memory cache, role→permission resolution via DB join |
| `services/CredentialService.js` | Encrypted storage for API keys (AI providers, GitHub) |
| `services/UsageLogger.js` | Per-agent action logging with cost tracking |
| `services/MemoryService.js` | Shared agent memory (vector? needs verification) |
| `middleware/auth.js` | JWT verify, role check, agent auth (`X-API-Key`), rate limiter, lockout (10 failures, 15min) |
| `middleware/permissions.js` | `requireAnyPermission` / `requireAllPermission` middleware |
| `migrations/apply.js` | 17 SQL files in non-numeric order (001→002→003→004→005→006→007→008→009→010→013→014→011→012→015→016→017) |

### Java Agent (`agent/`)

| File | What It Does |
|------|--------------|
| `AgentApp.java` | Infinite loop: polls backlog tickets, processes up to MAX_TICKETS (default 1) per cycle |
| `TicketProcessor.java` | Pipeline: pickup → generateContent (AI) → createBranch → postMessage → createPR → updateStatus |
| `GitHubService.java` | Creates branches and PRs via GitHub REST API. `createCommit()` is a **stub** — never called in pipeline |
| `ClaudeProvider.java` | Calls Anthropic Messages API. Model: `claude-sonnet-4-20250514`. Max 4096 tokens |
| `OpenAiProvider.java` | Calls OpenAI Chat Completions. Model: `gpt-4o`. Max 4096 tokens |
| `ApiService.java` | OkHttp client for all backend API calls (tickets, pickup, messages, credentials) |
| `AgentConfig.java` | Config from env vars: `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `POLL_INTERVAL_MS` (30s), `DRY_RUN`, `MAX_TICKETS` |
| `prompts/` | Hardcoded system prompts — does NOT fetch planning docs from the API |

### Frontend (`frontend/src/`)

| File | What It Does |
|------|--------------|
| `views/TicketBoard.vue` | 4-column drag-and-drop kanban. No planning integration. No transition validation client-side |
| `views/TicketDetail.vue` | Full ticket view: comments, attachments, approvals, planning files, status transitions |
| `views/Dashboard.vue` | Project list + usage tab. No agent status, no blocked queue |
| `views/AIAssistant.vue` | **Mock** — hardcoded responses, only recognizes "scan" intent |
| `views/ProjectTemplates.vue` | CRUD for custom templates. Create/delete only — no edit |
| `stores/auth.js` | Singleton Pinia store. Tokens/permissions in `localStorage` (3 keys: `vibecode_token`, `vibecode_user`, `vibecode_permissions`) |
| `api/client.js` | Native `fetch` — NOT axios (axios in deps is unused) |
| `router/index.ts` | Reads `localStorage` directly for auth guard. Route-level permission checks |

---

## What's Missing (Gaps)

### Gap 1: No Guided Flow — The Planner Is Missing

**Problem**: The kanban board is a blank canvas. Nothing tells the user "plan first" or enforces a sequence. Planning templates exist but are buried in a tab. The user can drag a ticket from backlog to done without ever writing a plan.

**Solution**: Replace the flat kanban with a **per-ticket phase machine** that enforces a progression:

```
    draft ──→ planning ──→ plan_approved ──→ assigned ──→ in_progress
                                                              │
    deployed ←── done ←── human_approval ←── review ←────────┘
                                                              │
                                                         blocked ──→ (awaiting human)
```

Each phase presents a dedicated screen, not just a column:

| Phase | UI | Behavior |
|-------|----|----------|
| **draft** | Title + description + priority form | The ticket creation screen |
| **planning** | Template selector → fill in planning files → mark ready | Enforced — ticket cannot advance without planning status = `completed` |
| **plan_approved** | Read-only plan view + approve/reject buttons | Optional per project config (can auto-approve) |
| **assigned** | Agent selector (or auto-assign) | Shows available agents, their current load, supported providers |
| **in_progress** | Real-time status feed from agent + Feedback tab | "Cloning repo" → "Generating" → "Writing tests" → "Committing". Agent can pause and ask questions via the Feedback tab |
| **blocked** | Agent's question + human reply form in Feedback tab | Surfaced in a "Needs your input" dashboard queue. Agent workspace is preserved while waiting |
| **review** | Diff viewer + line comments + "Request changes" / "Approve" | Changes requested → ticket goes back to `in_progress` |
| **human_approval** | Summary of changes + approve/reject | Approval → auto-transitions to `done` |
| **done** | "Deploy to [environment]" button | Deploy action triggers configured pipeline |
| **deployed** | Deployment info (env, timestamp, rollback button) | Rollback → ticket goes back to `done` + revert deploy |

**How to build it**:
1. Add a `phase` column to the `tickets` table (enum: the list above)
2. Extend `TicketService` with phase transition validation — each phase defines allowed next phases
3. Replace the static kanban columns with a phase-aware UI: show the current phase's screen, not just a status column
4. Keep the 4-status column view as an optional "compact" mode for power users

### Gap 2: Agent Doesn't Write Code

**Problem**: The Java agent's `createCommit()` is a stub. The pipeline creates an empty branch and opens a PR with zero code. The AI generates text but it's never committed to the repo.

**Solution**: The agent needs a full workspace lifecycle:

1. **Clone** the repo on startup (or mount as a volume)
2. **Fetch planning docs** from the API (`GET /tickets/:id/planning`) and include them in the AI prompt
3. **Call the AI** with a system prompt that includes: ticket description, planning docs, repo structure (list of files), coding conventions from `.cursorrules` / `AGENTS.md` / etc.
4. **Parse AI output** into file operations (which files to create/modify, with full content)
5. **Write files** to disk in the cloned repo
6. **Run compile/format/lint** if configured (optional, per project)
7. **Commit** with a descriptive message
8. **Push** to the feature branch
9. **Open PR** with a structured body (summary, changes made, testing done, any decisions)

**Required changes**:
- Agent needs `REPO_CLONE_DIR` config (persistent volume mount)
- The `generateContent()` output needs structured parsing (e.g., return JSON with `{files: [{path, content, action: "create"|"modify"|"delete"}]}`)
- Agent needs to fetch planning docs before generating
- The AI prompt should include repo context (not just the ticket)

### Gap 3: No Human-in-the-Loop (Ticket Feedback Section)

**Problem**: When the agent is working and hits a question it can't answer (ambiguous requirement, compile error it can't diagnose, architectural decision), it currently releases the ticket and logs a failure. There's no structured channel for agent → human → agent communication that keeps the work session alive.

**Solution: A dedicated "Feedback" section on every ticket.**

Every ticket has a **Feedback** panel — a structured Q&A area separate from general comments. When the agent is running in its workspace and gets stuck:

1. **Agent pauses** its current work (preserving its workspace state — partial edits, terminal history, pending changes)
2. **Agent posts a question** to the ticket's Feedback section with full context:
   ```json
   {
     "from": "agent-1",
     "asked_at": "2026-06-25T14:30:00Z",
     "question": "The spec says 'notify the user via email' but there's no email service configured. Should I use the existing NotificationService or add a new email provider?",
     "context": {
       "file": "src/services/TicketService.js",
       "line": 142,
       "terminal_output": "Error: EmailService not found\n  at createNotification (src/services/NotificationService.js:88)",
       "options": [
         {"label": "Use NotificationService", "description": "It has push/webhook but no email — would need extension"},
         {"label": "Add EmailService", "description": "New service, clean separation, more work"}
       ],
       "agent_recommendation": "Use NotificationService and extend it"
     }
   }
   ```
3. **Ticket transitions to `blocked` phase** — the agent stops working on it, but the workspace is preserved (container kept alive, repo state saved)
4. **Feedback appears in the ticket UI** — a dedicated Feedback tab with an "Awaiting your input" banner, the agent's question, context (file + line + terminal output), and options
5. **User answers in the UI** — clicks an option or types a free-form response:
   ```json
   {
     "from": "user-1",
     "answered_at": "2026-06-25T14:35:00Z",
     "answer": "Extend NotificationService",
     "elaboration": "Keep it consistent with existing patterns. Add an email channel to NotificationService instead of a standalone service."
   }
   ```
6. **Agent picks up the answer** on its next poll cycle (or via WebSocket push if implemented)
7. **Answer is injected into the agent's workspace** — fed as context to the next AI call, added to the system prompt, and optionally echoed to the agent's terminal:
   ```
   [Feedback from user-1 on ticket TICKET-42]
   Q: Should I use NotificationService or add EmailService?
   A: Extend NotificationService — keep it consistent with existing patterns.
   ```
8. **Agent resumes** from where it paused, now with the answer in its context

**The Feedback data model** (`ticket_feedback` table):

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ticket_id` | UUID → tickets | Parent ticket |
| `asked_by` | UUID → agents | Which agent asked |
| `question` | text | The agent's question |
| `context` | JSONB | File, line, terminal output, options, agent_recommendation |
| `answer` | text | The human's answer (null until answered) |
| `answered_by` | UUID → users | Who answered |
| `asked_at` | timestamptz | When the agent asked |
| `answered_at` | timestamptz | When the human answered (null until answered) |

**Agent workspace preservation**: When an agent posts a question, it does NOT release the ticket. The `locked_at` timer is extended so the orphan-recovery logic doesn't reclaim it. The agent container stays alive with its cloned repo and in-progress edits. If the agent has a terminal session, it pauses but doesn't close.

**Frontend Feedback UI**:

The ticket detail view gets a **"Feedback" tab** (alongside Comments, Attachments, Planning):

```
┌─────────────────────────────────────────────────────────────┐
│  Overview  |  Planning  |  Feedback (1)  |  Comments  | ... │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ⏸️ Awaiting your input                                     │
│                                                             │
│  Agent agent-1 asked 5 minutes ago:                         │
│                                                             │
│  "The spec says 'notify the user via email' but there's     │
│   no email service configured. Should I use the existing    │
│   NotificationService or add a new email provider?"         │
│                                                             │
│  ┌─ Context ─────────────────────────────────────────────┐ │
│  │  File: src/services/TicketService.js:142              │ │
│  │  Terminal:                                            │ │
│  │  Error: EmailService not found                        │ │
│  │    at createNotification (src/services/...:88)        │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ○ Use NotificationService and extend it              │  │
│  │ ○ Add a new EmailService                             │  │
│  │ ○ Other (write your own) [________________________]  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Additional notes (optional):                         │  │
│  │  [Keep it consistent with existing patterns. Add     │  │
│  │   an email channel to NotificationService.]          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [Submit Answer]                                            │
└─────────────────────────────────────────────────────────────┘
```

And on the Dashboard, a "Needs your input" queue shows all tickets with unanswered feedback, sorted by oldest first:

```
┌─────────────────────────────────────────────────────────────┐
│  🔔 Needs Your Input (2)                                    │
│                                                             │
│  · TICKET-42: "Should I use NotificationService or..." 15m │
│  · TICKET-38: "The CSS breakpoint conflicts with..."   42m │
└─────────────────────────────────────────────────────────────┘
```

**Relationship to the guided flow**: The Feedback section is accessible from any phase where an agent is involved (assigned, in_progress, review). The ticket doesn't need to be in a special "blocked" phase for feedback to work — the phase can stay as `in_progress` while awaiting feedback, with a `has_pending_feedback` flag. The dashboard queue surfaces all pending feedback regardless of phase.

**Agent-side implementation** (in the Java agent's `TicketProcessor.java`):

```java
// During the work loop, after each major operation:
List<Feedback> pendingFeedback = apiService.getPendingFeedback(ticketId);
if (!pendingFeedback.isEmpty()) {
    Feedback latest = pendingFeedback.get(pendingFeedback.size() - 1);
    // Inject the answer into the workspace context
    workspaceContext.addNote("User feedback on " + ticketId + ": " + latest.getAnswer());
    // Optionally feed it to the terminal as stdin or env var
    if (agentConfig.isTerminalFeedbackEnabled()) {
        terminalSession.inject(latest.getAnswer());
    }
    // Mark as consumed (or let the API track it)
    apiService.acknowledgeFeedback(latest.getId());
}

// When the agent gets stuck:
String question = agent.detectAmbiguity();  // heuristic: low confidence, error, or explicit ask
if (question != null) {
    apiService.postFeedback(ticketId, question, context);
    agent.waitForFeedback(pollIntervalMs);  // polls GET /feedback/pending until answered
    // Resume with the answer in context
}
```

**Why this is more powerful than generic comments**:
1. **Structured, not freeform** — the human sees options, file context, terminal output. They don't need to ask "what file? what error?"
2. **Machine-readable** — the Java agent can parse the answer and inject it into the terminal or AI prompt without NLP
3. **Workspace-preserving** — the agent doesn't release the ticket, so it resumes instantly instead of re-cloning and re-generating
4. **Visible in the flow** — the feedback tab is part of the ticket's guided phase UI, not buried in a message log
5. **Accountable** — who asked what, when, and what the human decided is recorded permanently

**3b. Web Terminal for Deep Debugging**
- Agent runs in a Docker container with `docker exec` accessible
- Backend proxies a web terminal via WebSocket (xterm.js in the frontend, container exec on the backend)
- Human can SSH into the agent's workspace, inspect files, run commands, see what went wrong
- This is a significant build — Phase 12 in priority

**3c. Agent Heartbeat & Liveness**
- Agent sends periodic heartbeats to the API (`POST /agents/:id/heartbeat`)
- Backend tracks: last_seen, current_ticket_id, current_step, memory_usage, cpu_usage
- Frontend shows live status per agent
- Agents that miss N heartbeats are marked offline; their tickets are auto-released

### Gap 4: No Code Review UI

**Problem**: Approval just toggles status to `done`. No one sees the diff. No one comments on code. The entire review happens externally (if at all).

**Solution**:
- A diff viewer in the ticket review phase (inline or split view)
- Rendered from the GitHub PR diff, or computed from the agent's file changes
- Line-level commenting (stored as ticket comments with file/line metadata)
- "Request changes" action → ticket goes back to `in_progress` with a summary of requested changes
- "Approve" → ticket advances to the approval phase
- GitHub PR status synced via webhook (or API polling) so the in-app review mirrors GitHub

### Gap 5: No Deployment Pipeline

**Problem**: Ticket reaches `done` and stops. No deploy. No environments. No rollback.

**Solution** (keep it simple — delegate to existing CI):
- Users define environments per project via the UI (name, type, deploy webhook URL, optional branch pattern)
- A "Deploy" action on `done` tickets triggers the configured webhook (GitHub Actions, Jenkins, custom script)
- Ticket gains a `deployed` status with deployment metadata (env, timestamp, commit SHA)
- A "Rollback" button reverts the deployment and moves the ticket back to `done`
- Deployment history per project (what was deployed when, by whom)

### Gap 6: No Scheduling or Timeline

**Problem**: No milestones, no sprints, no release grouping. Tickets are a flat list.

**Solution** (minimal — not a full Jira):
- **Milestones**: Group tickets under a named milestone with a target date. One milestone per project at a time (keep it focused).
- **Sprint view**: A filtered board showing tickets assigned to the current milestone, with an estimate vs. actual progress bar.
- **Dependency tags**: Tickets can "depends on" other tickets. Blocked until dependency is `done`.

### Gap 7: No Agent Visibility

**Problem**: The frontend AI Assistant is a mock. No agent status, no ticket queue per agent, no cost dashboard.

**Solution**:
- Agent list view showing: name, status (online/idle/offline), current ticket, tickets completed today, actions today / daily limit, total cost
- Agent detail view: history of actions, tickets worked on, cost breakdown per ticket
- Real-time ticket progress updates via polling (agent writes step updates to the ticket, frontend polls)

---

## How to Plug In AI Providers

### Problem

The Java agent hardcodes provider selection in `AgentConfig.java`:
```java
AI_PROVIDER = getEnv("AI_PROVIDER", "claude"); // "claude" or "openai"
AI_MODEL = getEnv("AI_MODEL", "claude-sonnet-4-20250514");
AI_API_KEY = getEnv("AI_API_KEY", "");
```

This means:
- Only two providers (Claude, OpenAI) — no local models
- One model per agent instance — can't route different tickets to different models
- API key is an env var, not fetched from the backend credential store
- Endpoint URL is hardcoded per provider implementation

### Solution: Per-Project Provider Routing

Store provider config per **project** (not per agent):

| Field | Type | Description |
|-------|------|-------------|
| `provider` | string | `ollama`, `openai`, `claude`, `vllm`, `llamacpp` |
| `endpoint_url` | string | The API base URL (e.g. `http://192.168.1.50:11434/v1`) |
| `model` | string | Model name (e.g. `codellama:34b`, `gpt-4o`) |
| `api_key_ref` | string | Reference to the credential store (null for local models) |
| `fallback_provider` | string | Optional fallback (e.g. use Claude if local model fails) |

The backend already has:
- A `providers` route and provider management endpoints
- A credential system for storing API keys

**What needs to change**:
1. Add a `provider_config` JSONB column to the `projects` table
2. The agent fetches project config at startup, not from env vars
3. Add an OpenAI-compatible adapter class — every local model server (Ollama, vLLM, llama.cpp) speaks the `/v1/chat/completions` format, so one adapter covers all of them
4. The credential system serves API keys for cloud providers; local providers need no key
5. Fallback logic: if the primary provider returns an error or the response is low quality (heuristic), retry with the fallback

**OpenAI-compatible adapter** (single class, covers all local servers):
```java
class OpenAiCompatibleProvider implements AiProvider {
    String endpointUrl;  // from project config
    String model;        // from project config
    String apiKey;       // null for local, from credential store for cloud

    String generateResponse(String systemPrompt, String userMessage) {
        POST to {endpointUrl}/chat/completions
        Body: { model, messages: [system, user], max_tokens: 4096 }
        Headers: { Authorization: Bearer {apiKey} }  // omitted if null
    }
}
```

**Per-ticket model routing** (advanced — future):
- An "easy" ticket (typo fix, test addition) goes to a fast local model
- A "complex" ticket (architectural change, new feature) goes to Claude
- The project config defines routing rules based on ticket labels, priority, or estimate

---

## How to Provision Compute Locally (Self-Hosted)

You want all of this to run on your own hardware — no cloud. Three tiers of effort:

### Tier 1: Static Agent Containers (Works Today)

```
┌──────────────────────────────────────────────────────────┐
│                   Your Machine (homelab / VPS)             │
│                                                            │
│  ┌──────────────┐   ┌──────────────┐                      │
│  │  Backend +   │   │  AI Model     │                      │
│  │  Frontend +  │   │  Server       │                      │
│  │  PostgreSQL  │   │  (Ollama)     │                      │
│  └──────┬───────┘   └──────┬───────┘                      │
│         │                   │                              │
│  ┌──────┴───────────────────┴───────┐                      │
│  │  Docker network (vibecode_default)│                      │
│  │                                  │                      │
│  │  ┌──────────────────────────┐   │                      │
│  │  │  Agent Worker 1          │   │                      │
│  │  │  REPO_CLONE_DIR=/repos   │   │                      │
│  │  │  AI_ENDPOINT=http://...  │   │                      │
│  │  │  mounts: /repos volume   │   │                      │
│  │  └──────────────────────────┘   │                      │
│  │  ┌──────────────────────────┐   │                      │
│  │  │  Agent Worker 2          │   │                      │
│  │  │  ...                     │   │                      │
│  │  └──────────────────────────┘   │                      │
│  └──────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

- You deploy N agent containers, each pointing at the same backend
- Each agent has `PROJECT_ID` set to a specific project (or an agent pool routes tickets)
- Repos are cloned to a shared Docker volume (persistent, avoids re-cloning)
- AI model server runs as another container on the same machine
- **No provisioning orchestration** — you `docker compose up --scale agent=3` manually

### Tier 2: Pool Manager (Medium Complexity)

A new service that manages agent containers:

```
Pool Manager API (new Node.js service or backend module):
  POST /pool/request  →  finds an idle agent or spawns one, returns agent_id
  POST /pool/release  →  marks agent as idle (or destroys it after cooldown)
  GET  /pool/status   →  list all agents: id, status, current_ticket, uptime, memory
  GET  /pool/machines →  list available Docker hosts
```

Agent lifecycle under pool management:
1. Ticket enters `assigned` phase
2. Backend calls `POST /pool/request` with `{ project_id, required_provider, repo_url }`
3. Pool manager checks: is there an idle agent that already has this repo cloned? Yes → assign. No → spawn a new container.
4. Pool manager provisions a container: `docker run -e PROJECT_ID=... -e BACKEND_URL=... -e AI_ENDPOINT=... -v repos:/repos agent-image`
5. Container polls the backend, picks up the ticket, works it
6. When the ticket reaches `done` or the agent is idle for N minutes, pool manager destroys the container
7. Repo volume persists between spawns to avoid re-cloning

**How to implement**:
- The pool manager needs access to the Docker socket (`/var/run/docker.sock`) or uses the Docker SDK
- Agent configuration is passed via environment variables, not baked into the image
- The pool manager updates the database when spawning/removing agents (so the frontend shows live status)

### Tier 3: Dynamic Provisioning Across Machines (Full Vision)

```
┌──────────────────────────────────────────────────────────────────┐
│                    Control Plane (Backend service)                 │
│                                                                    │
│  1. Ticket assigned → need worker for project X                    │
│  2. Pool manager checks machine registry                           │
│  3. Picks best host (least loaded, has AI model, has repo cached)  │
│  4. SSH into host → docker pull → docker run agent container       │
│  5. Agent connects back to backend                                 │
│  6. When done → docker stop → cleanup                              │
└─────────────────────────────────────────────────────────────────-─┘

     SSH                   SSH                   SSH
      │                     │                     │
      ▼                     ▼                     ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Machine A   │   │  Machine B   │   │  Machine C   │
│  (has GPU)   │   │  (CPU only)  │   │  (has repo)  │
│  Ollama      │   │  Agent pool  │   │  Agent pool  │
│  Agent pool  │   │              │   │              │
└──────────────┘   └──────────────┘   └──────────────┘
```

Machine registry (new DB table: `compute_nodes`):
| Field | Description |
|-------|-------------|
| hostname | SSH-accessible host |
| ssh_user | SSH user |
| ssh_key_ref | Reference to credential store |
| labels | `{ gpu: true, model: "codellama", repo_cache: ["org/repo"] }` |
| capacity | Max concurrent agents |
| status | online / offline / degraded |

**This is a large build. Do not start here.** Tier 1 and Tier 2 cover 90% of the value.

### What About GPU?

The AI model server runs separately from the agent. The agent is a CPU-only container that makes HTTP calls to the model server. You can:
- Run Ollama on the same machine (easy, one GPU shared across all agents)
- Run Ollama on a dedicated GPU machine (homelab with a 3090/4090)
- Use a CPU model for cheap tickets (e.g. `qwen2.5-coder:7b`) and GPU model for complex ones

This separation means agents are **stateless and lightweight** — they only need CPU, RAM, and disk for repos. The GPU is exclusively used by the model server.

---

## Architecture Diagram (Target State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Vue SPA)                            │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │  Guided   │  │ Planning │  │  Code    │  │  Agent Console   │    │
│  │  Flow     │  │  Editor  │  │  Review  │  │  (Web Terminal)  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ Dashboard│  │ Kanban   │  │ Agents   │  │  Deployments     │    │
│  │ (blocked │  │ (compact)│  │ (status) │  │  (environments)  │    │
│  │  queue)  │  │          │  │          │  │                  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ REST API + WebSocket
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Backend (Node.js/Express)                      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  Existing:  Auth  │  Tickets  │  Projects  │  Agents     │       │
│  │             Planning │  Approvals │  GitHub  │  ...        │       │
│  ├──────────────────────────────────────────────────────────┤       │
│  │  New:  Phase Machine  │  Provider Router  │  Pool API    │       │
│  │        Web Terminal Proxy  │  Webhook Receiver           │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  Services:  PhaseService  │  ProviderService              │       │
│  │             PoolManager   │  TerminalProxy                │       │
│  │             DeployService │  WebhookService               │       │
│  └──────────────────────────────────────────────────────────┘       │
└──────┬──────────────────┬──────────────────────┬────────────────────┘
       │                  │                      │
       ▼                  ▼                      ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│  PostgreSQL   │  │  Agent Workers   │  │  AI Model Servers      │
│  (pgvector)   │  │  (Docker pool)   │  │  (self-hosted)         │
│               │  │                  │  │                        │
│  users        │  │  ┌────────────┐  │  │  ┌──────────────────┐ │
│  projects     │  │  │ agent-1    │  │  │  │  Ollama           │ │
│  tickets      │  │  │ Project: A │  │  │  │  :11434           │ │
│  phases       │  │  │ Model:     │  │  │  │  codellama:34b    │ │
│  planning     │  │  │ codellama  │  │  │  └──────────────────┘ │
│  credentials  │  │  └────────────┘  │  │                        │
│  providers    │  │  ┌────────────┐  │  │  ┌──────────────────┐ │
│  templates    │  │  │ agent-2    │  │  │  │  vLLM             │ │
│  deployments  │  │  │ Project: B │  │  │  │  :8000            │ │
│  compute_nodes│  │  │ Model:     │  │  │  │  deepseek-coder   │ │
│  milestones   │  │  │ claude     │  │  │  └──────────────────┘ │
│               │  │  └────────────┘  │  │                        │
└──────────────┘  └──────────────────┘  └────────────────────────┘
```

---

## Gap 8: No "Test Everything" Button — System Diagnostics Missing

**Problem**: With so many moving parts (backend, frontend, DB, agents, AI provider, GitHub credentials, planning system), when something breaks the user has no way to know *what* broke. The only way to test the system is via CLI (`backend/integration-test/run.sh`), which requires Docker, bash, and knowing the test exists. A new user setting up the system has no feedback that everything is wired correctly.

The existing integration test suite is comprehensive (19 curl-based suites covering auth, tickets, agents, billing, etc.) but it's hidden in a shell script. There is no UI for it, no "Run Diagnostics" button, no visual pass/fail per component.

**Solution**: A **System Diagnostics** feature — a one-click button in the UI that runs a series of checks against every major component and reports pass/fail per step with timing and error details.

### What Each Diagnostic Step Checks

**Fast checks (< 5 seconds total)** — run every time:

| Step | What It Tests | How | Expected |
|------|---------------|-----|----------|
| 1. Backend API | Server is running and responding | `GET /api/health` | `status: "ok"` |
| 2. Database | Migrations applied, read/write works | `POST /api/v1/projects` → create → delete | Project created and deleted |
| 3. Auth flow | Register, login, token validation | `POST /api/auth/register` → `POST /api/auth/login` → `GET /api/auth/me` | Token round-trips, user data matches |
| 4. Frontend | SPA is serving | `GET /` on frontend URL | HTTP 200, HTML response |
| 5. Planning system | Templates load, can be applied | `GET /api/v1/projects/:id/templates` → `POST /api/v1/tickets/:id/planning/apply-template` | Templates listed, planning files created |
| 6. Credential store | Encrypt/store/decrypt round-trip | `POST /api/v1/credentials` → `GET /api/v1/credentials/:id/decrypt` | Round-trip succeeds, decrypted value matches original |

**Slow checks (5–30 seconds)** — run on demand or in "extended" mode:

| Step | What It Tests | How | Expected |
|------|---------------|-----|----------|
| 7. AI Provider | Model endpoint responds | `POST` to configured AI endpoint with a trivial prompt | Returns a valid completion within 30s |
| 8. Agent liveness | At least one agent is online | `GET /api/v1/agents` + heartbeat check | Agent exists with recent heartbeat (< 2min) |
| 9. GitHub connection | Token is valid, repo is accessible | `GET /api/v1/github/:projectId` → try listing branches | Repo responds, branches returned |
| 10. Full agent flow | End-to-end: create ticket → agent picks up → code written → PR opened | Create test ticket in a dedicated test project, wait up to 5 minutes for agent to complete | Ticket reaches `review` status, PR URL exists |

### UI Design

A **"System Health"** page or dashboard tab with:

```
┌─────────────────────────────────────────────────────────────┐
│  🔬 System Diagnostics                  [Run Tests] [▼]     │
│                                                             │
│  Last run: 2 minutes ago  |  Duration: 4.2s                │
│                                                             │
│  ✅ Backend API ................ 142ms  ✓ HTTP 200 + ok     │
│  ✅ Database ................... 231ms  ✓ Create/delete     │
│  ✅ Auth flow .................. 312ms  ✓ Register/login    │
│  ✅ Frontend ................... 89ms   ✓ HTTP 200          │
│  ✅ Planning system ............ 187ms  ✓ Templates applied │
│  ✅ Credential store ........... 94ms   ✓ Encrypt/decrypt   │
│  ⚠️ AI Provider ................ ✗ 8.4s  Connection refused │
│  ❌ Agent liveness ............. ✗       No agents online    │
│  ⚪ GitHub connection .......... —       Not configured     │
│  ⚪ Full agent flow ............ —       Skipped (slow)     │
│                                                             │
│  Summary: 6/8 passed, 1 warning, 1 failed, 2 skipped       │
└─────────────────────────────────────────────────────────────┘
```

- Each row has: icon (✅ / ⚠️ / ❌ / ⚪), name, duration, brief result
- Failed/warning rows are expandable for error details
- "Run Tests" button re-runs all checks
- "▼" dropdown has: "Run Extended" (includes slow checks), "Run Full Agent Flow", "Clear Results"
- Results persist until next run (stored in backend or localStorage)
- The full agent flow test gets its own progress bar (polling every 10s, showing current step)

### Backend Implementation

**New endpoint**: `POST /api/diagnostics/run`

Starts an async test run, returns a `run_id` immediately:

```json
POST /api/diagnostics/run
{ "mode": "fast" | "extended" | "full_agent" }

Response 202:
{
  "run_id": "uuid-123",
  "status": "running",
  "steps": [
    { "name": "Backend API", "status": "running" },
    { "name": "Database", "status": "pending" },
    ...
  ]
}
```

**New endpoint**: `GET /api/diagnostics/status/:run_id`

Polled by frontend to get live progress:

```json
{
  "run_id": "uuid-123",
  "status": "running",
  "steps": [
    { "name": "Backend API", "status": "passed", "duration_ms": 142, "detail": "HTTP 200, status: ok" },
    { "name": "Database", "status": "running", "duration_ms": null, "detail": null },
    ...
  ]
}
```

**Dispatcher service**: `DiagnosticsService.js` runs each check sequentially (or in parallel for independent ones):

```javascript
class DiagnosticsService {
  runs = new Map();  // run_id → { status, steps[], createdAt }

  async run(mode) {
    const runId = uuid.v4();
    const steps = this.buildStepList(mode);
    this.runs.set(runId, { status: 'running', steps, createdAt: Date.now() });

    // Run steps concurrently where possible
    const independentSteps = steps.filter(s => s.group === 'fast');
    const dependentSteps = steps.filter(s => s.group !== 'fast');

    await Promise.all(independentSteps.map(s => this.executeStep(runId, s)));
    for (const step of dependentSteps) {
      await this.executeStep(runId, step);
    }

    this.runs.get(runId).status = 'completed';
    return runId;
  }

  async executeStep(runId, step) {
    const start = Date.now();
    this.updateStep(runId, step.name, 'running');
    try {
      const result = await step.handler();
      this.updateStep(runId, step.name, result.passed ? 'passed' : 'failed', Date.now() - start, result.detail);
    } catch (err) {
      this.updateStep(runId, step.name, 'error', Date.now() - start, err.message);
    }
  }
}
```

**Test project isolation**: The full agent flow test creates a dedicated "Vibecode Diagnostics" project. If one already exists from a previous run, it's reused (old tickets are cleaned up). If the test succeeds, the PR is left open for the user to inspect, labeled `diagnostics-test`. On failure, the test project is left in place so the user can debug.

### Frontend Implementation

**New view**: `views/SystemDiagnostics.vue` at route `/diagnostics`

- Shows the diagnostics table as described above
- Polls `GET /api/diagnostics/status/:run_id` every 1s while a run is in progress
- Uses the same color/icon scheme as the table above
- "Run Tests" button (always visible)
- Dropdown menu with test mode options
- Results stored in localStorage so they survive page reload (but a new run overwrites them)

**New route**: Add to `router/index.ts`:
```typescript
{
  path: '/diagnostics',
  name: 'SystemDiagnostics',
  component: () => import('../views/SystemDiagnostics.vue'),
  meta: { requiresAuth: true },
}
```

**Dashboard link**: Add a "System Health" card or button to `Dashboard.vue` that shows a summary (e.g., "Last test: 6/8 passed") and links to `/diagnostics`.

### What This Unlocks

- **New user onboarding**: Run diagnostics after first `docker compose up` to verify everything is wired before creating any real work
- **Debugging**: When something breaks, one click tells you *which* component is failing instead of guessing
- **Configuration validation**: After adding a new AI provider or GitHub token, run diagnostics to confirm it works
- **Agent troubleshooting**: The full agent flow test catches issues like "agent can't clone repo" or "AI provider returns 403" before the user creates a real ticket
- **CI integration**: The same diagnostics engine can be called from CI (instead of the current shell-based integration tests), giving a unified test interface

### Build Order Placement

Insert between existing phases 6 and 7 (after static agent containers work, before agent heartbeats):

| Phase | What | Why Here |
|-------|------|----------|
| **6b** | System Diagnostics UI + backend endpoint | After agents + AI provider work, the user needs a way to verify the full stack. Also a prerequisite for on-demand agent flow testing. |

The diagnostics UI is low effort (one new service, one new view) and high value — it should come early.

---

## New Database Tables Needed

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `ticket_phases` | Phase transition log | `ticket_id`, `phase`, `entered_at`, `exited_at`, `actor` (human/agent/system) |
| `provider_configs` | Per-project AI provider settings | `project_id`, `provider`, `endpoint_url`, `model`, `fallback_provider`, `routing_rules` (JSONB) |
| `agent_heartbeats` | Agent liveness tracking | `agent_id`, `last_seen`, `current_ticket_id`, `current_step`, `memory_usage`, `status` |
| `environments` | Deploy targets per project | `project_id`, `name` (staging/prod), `type`, `webhook_url`, `branch_pattern` |
| `deployments` | Deployment history | `ticket_id`, `environment_id`, `status`, `commit_sha`, `deployed_at`, `rolled_back_at` |
| `milestones` | Ticket grouping | `project_id`, `name`, `target_date`, `is_active` |
| `compute_nodes` | Machine registry for pool | `hostname`, `labels` (JSONB), `capacity`, `status` |
| `ticket_feedback` | Structured agent→human→agent Q&A per ticket | `ticket_id`, `asked_by` (agent), `question`, `context` (JSONB with file/line/terminal/options), `answer`, `answered_by` (user) |

---

## New Backend Services Needed

| Service | Purpose | Key Methods |
|---------|---------|-------------|
| `PhaseService.js` | Phase transition validation and enforcement | `transition(ticketId, fromPhase, toPhase)`, `getAllowedNextPhases(ticketId)`, `getGateStatus(ticketId, phase)` |
| `ProviderService.js` | AI provider config per project, model routing | `getConfig(projectId)`, `getRoutingRule(projectId, ticket)`, `testConnection(providerConfig)` |
| `PoolManager.js` | Agent container lifecycle | `requestAgent(projectId, requirements)`, `releaseAgent(agentId)`, `getPoolStatus()` |
| `DeployService.js` | Trigger/rollback deployments | `deploy(ticketId, environmentId)`, `rollback(deploymentId)`, `getHistory(projectId)` |
| `WebhookService.js` | Process incoming webhooks (GitHub PR sync, deploy status) | `handleGitHubPR(payload)`, `handleDeployStatus(payload)` |
| `TerminalProxy.js` | WebSocket→docker exec proxy | `connect(agentId, sessionId)`, `disconnect(sessionId)` |
| `DiagnosticsService.js` | Run system health checks | `run(mode)`, `getStatus(runId)`, `executeStep(runId, step)` |

---

## New Frontend Views Needed

| View | Route | Purpose |
|------|-------|---------|
| `PhaseFlow.vue` | `/projects/:id/tickets/:id/flow` | The guided step-by-step phase UI |
| `CodeReview.vue` | `/projects/:id/tickets/:id/review` | Diff viewer + line comments + approve/reject |
| `AgentConsole.vue` | `/agents/:id/console` | Web terminal into the agent's workspace |
| `AgentList.vue` | `/agents` | Agent status dashboard |
| `Deployments.vue` | `/projects/:id/deployments` | Environment config + deployment history |
| `Milestones.vue` | `/projects/:id/milestones` | Milestone management + progress |
| `BlockedQueue.vue` | `/blocked` | All tickets waiting for human input |
| `SystemDiagnostics.vue` | `/diagnostics` | One-click system health checker with per-component pass/fail |

---

## Build Order

| Phase | What | Why This Order |
|-------|------|----------------|
| **1** | Fix the Java agent's `createCommit()` — clone repo, write AI output to disk, commit, push | The agent is useless without this. Everything downstream depends on real code existing in the repo |
| **2** | Ticket phase machine (PhaseService + phase column + phase UI) | The core UX change — users follow a guided flow instead of a blank board |
| **3** | Planning as a gate (phase machine enforces plan before assign) | Phase 2 is just a UI without enforcement. This makes planning mandatory |
| **4** | Ticket Feedback section (DB table + API + Feedback tab UI + agent-side polling) | Without this, every agent failure is a dead end. Human-in-the-loop via a structured Q&A panel unlocks real autonomy. The Feedback tab is accessible from any phase, and the dashboard has a "Needs your input" queue |
| **5** | Per-project AI provider config (ProviderService + provider_configs table + OpenAI-compatible adapter) | Lets you plug in Ollama locally. Cuts cloud costs immediately |
| **6** | Static agent containers + `AI_ENDPOINT_URL` config | After Phase 5, you can run agents against local models on the same machine |
| **7** | System Diagnostics UI + backend endpoint + full-agent flow test | One-click verification of every component. Essential for onboarding and debugging a multi-service system |
| **8** | Agent heartbeat + liveness + real-time status UI | Makes agents observable. Needed before scaling to multiple agents |
| **9** | Code review UI (diff viewer, line comments, request changes) | Closes the loop between agent output and human approval |
| **10** | Pool Manager (Tier 2 compute provisioning) | Scales from 1 to N agents without manual container management |
| **11** | Deployment pipeline (environments, deploy/rollback actions) | Completes the flow from plan to production |
| **12** | Web terminal proxy | Deep debugging for when agent questions aren't enough |
| **13** | Milestones + timeline view | Added value after the core loop works |
| **14** | Dynamic provisioning across machines (Tier 3) | Full vision — auto-scale on your own hardware |
| **15** | Per-ticket model routing (cheap tickets → local model, complex → cloud) | Optimizes cost/quality tradeoff |

---

## Concrete First Steps (Start Here)

These are the smallest meaningful changes that unlock the rest of the system:

1. **Fix `createCommit()` in the Java agent** (`agent/src/.../GitHubService.java`):
   - Add a `REPO_CLONE_DIR` config option
   - On ticket pickup, clone the repo if not already cloned
   - After AI generation, parse the output into file paths + content
   - Write files, stage, commit, push
   - Add the commit SHA to the PR body

2. **Add `AI_ENDPOINT_URL` to the agent config** (`AgentConfig.java`):
   - New env var: `AI_ENDPOINT_URL` (default: null → use built-in Claude/OpenAI)
   - When set, use the OpenAI-compatible adapter pointed at this URL
   - Test with `http://host.docker.internal:11434/v1` for local Ollama

3. **Add `phase` column to tickets** and a stub `PhaseService`:
   - Enum: `draft`, `planning`, `plan_approved`, `assigned`, `in_progress`, `blocked`, `review`, `human_approval`, `done`, `deployed`
   - Default: `draft` for new tickets
   - `PhaseService.transition()` validates allowed next phases
   - No UI changes yet — just the backend foundation

4. **Add a "Needs input" dashboard section** (`Dashboard.vue`):
   - Query tickets with `phase = blocked`
   - Show each with the agent's question
   - Inline reply form

5. **Make planning a gate** (`TicketService.js`):
   - `transition(ticketId, 'planning', 'plan_approved')` requires `planning_status = 'completed'`
   - Without this, the agent can pick up unplanned tickets

6. **Build the diagnostics endpoint and UI** (`DiagnosticsService.js` + `SystemDiagnostics.vue`):
   - Implement the fast checks first (API health, DB, auth, frontend) — these need zero external services
   - Add the slow checks as the AI provider and agent come online (Phase 5 and 6)
   - The UI is reusable: it renders whatever checks the backend returns, so new checks auto-appear

---

> *This document is a living vision. Update it as the system evolves.*
