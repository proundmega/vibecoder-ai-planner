# 03_ARCHITECT_IMPLEMENTATION.md — Autonomous Coding Harness

## Ticket: fg-30 — Autonomous Coding Harness

**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-10-31
**Date completed**: —
**PR**: —
**Branch**: `feature/fg-30-autonomous-coding-harness`
**Scope**: Both (agent, backend, frontend, infrastructure)

**Dependencies**: bp-120, bp-121 (agent connectivity fixes) should be merged first. Phase 1 can start
with local agents if those are not yet complete.

---

### a) Purpose

Replace the blind JSON file-operation agent with a real coding harness (OpenCode server) supervised by
the Java agent, with durable human-in-the-loop questions, autonomy policies, budgets and auditable
sessions. Humans plan and review; agents implement and verify; questions pause and resume cleanly.

Implementation is split into four phases. Each phase must be merged and functioning before the next.

| Phase | Ticket | Outcome |
|---|---|---|
| 1 | fg-30 | Harness executes a real ticket; verification; PR; feature flag |
| 2 | TBD | Questions, permissions, notifications, UI, resume |
| 3 | TBD | Policies, budgets, plan gate, multi-agent loop |
| 4 | TBD | Sandbox hardening, observability, retention |

---

### b) Actions

**CRITICAL**: Read `01`, `02` and `04` before starting. Phase 1 is specified exactly in
`04_SPECIFICATION.md`. Do not implement Phase 2+ until Phase 1 is validated on a real repository.

#### Implementation Order

---

## Phase 0 — Prerequisites (½ day)

1. **Verify agent connectivity fixes** — `bp-120`, `bp-121`
   - Provider config must return a single, flat data envelope.
   - Agent heartbeat listing must not depend on heartbeats existing first.
   - Non-localhost agents must be accepted per the project policy.
   - *Depends on*: nothing.

2. **Pin the harness version**
   - Choose an OpenCode version, pin it in `agent/Dockerfile` and add a `HARNESS_VERSION` build arg.
   - Capture its OpenAPI document (`/doc`) as a test fixture.
   - *Depends on*: nothing.

3. **Provider smoke test**
   - Manually run `opencode serve` with the chosen provider/model and a tiny session in a scratch repo.
   - Record the config shape that works (provider block, model id, permissions).
   - *Depends on*: Step 2.

4. **OpenCode Go session header (prerequisite for legacy provider paths)**
   - OpenCode Go requires `x-opencode-session` on every request; direct calls return
     `400 MissingSessionID` without it.
   - The harness (OpenCode server) sends this automatically, but the planner's `GenericProvider`
     and the Java `OpenAiCompatibleProvider` do not.
   - Add an optional session-header setting to both providers (or detect the
     `opencode.ai/inference/go` base URL) so the existing provider test and legacy agent can use
     the same key.
   - *Depends on*: Step 3.

---

## Phase 1 — Harness foundation (fg-30) — 1–2 weeks

**Goal**: a backlog ticket is implemented, verified and published as a PR by OpenCode, with no human
interaction. Questions are disabled in this phase (the model must make assumptions).

### Step 1: Harness config and interface — `agent/src/main/java/com/vibecode/agent/harness/`

- Create `HarnessConfig.java`:
  - mode (`legacy`/`opencode`), binary, startup timeout, idle timeout, max duration,
    verification commands, protected paths, workspace root.
  - Read from env with defaults; validate.
- Create `HarnessClient.java` interface:
  - `StartResult start(Path workspace, HarnessConfig config)`
  - `String createSession(...)`
  - `void prompt(sessionId, prompt)`
  - `Stream<HarnessEvent> events(sessionId)`
  - `Diff diff(sessionId)`
  - `void stop()`
- Create `HarnessEvent.java` (sealed/record types for tool, message, idle, error).
- *Depends on*: Phase 0.

### Step 2: OpenCode server client — `agent/src/main/java/com/vibecode/agent/harness/OpenCodeClient.java`

- Start `opencode serve` with:
  - random free port, `--hostname 127.0.0.1`,
  - `OPENCODE_SERVER_PASSWORD` random per run,
  - `OPENCODE_CONFIG` pointing to a temp config outside the workspace,
  - `HOME` pointing to a per-run temp directory.
- Health poll `/global/health` with timeout/backoff.
- Create session: `POST /session`.
- Prompt: `POST /session/:id/message` (v2 `/api/session/:id/prompt` if pinned version requires).
- Events: `GET /event` SSE parsed with OkHttp SSE.
- Diff: `GET /session/:id/diff` or `git diff` fallback.
- Stop: delete session, terminate process, delete temp config/home.
- *Depends on*: Step 1.
- *Tests*: fake HTTP/SSE server.

### Step 3: Temporary OpenCode config — `HarnessConfigWriter.java`

- Render `opencode.json` with:
  - provider/model mapping from the planner provider config,
  - `permission` rules: deny `git push*`, `git commit*`, `.env*`, `external_directory`; deny `question`
    in Phase 1; allow read/search/edit/tests; ask for network/installs/deletes,
  - instructions/AGENTS.md references,
  - optional formatter/LSP settings.
- Write outside the workspace (temp dir), mode 0600, delete after run.
- Never log the API key; redact errors.
- *Depends on*: Step 2.

### Step 4: Prompt builder — `PromptBuilder.java`

- Inputs: ticket, planning docs, agent policy (Phase 3), repo conventions, verification commands.
- Output sections:
  - role and objective,
  - ticket + acceptance criteria,
  - planning docs,
  - repository map/conventions (`AGENTS.md`, stack commands),
  - rules: inspect before edit, minimal change, test-first when required, no push/commit/merge,
    no secrets, no unrelated refactors, ask only if Phase 2 is enabled,
  - definition of done and final summary format.
- *Depends on*: Step 1.
- *Tests*: includes all sections; truncates huge planning docs safely; no secrets.

### Step 5: Harness ticket processor — `HarnessTicketProcessor.java`

- Same contract as `TicketProcessor` (`processTicket(Ticket)`), selected by `HARNESS_MODE`.
- Flow:
  1. pick up ticket,
  2. clone repo + branch,
  3. start server + session,
  4. send prompt,
  5. consume events → heartbeat `current_step`, log progress,
  6. wait for idle/error with wall-clock timeout,
  7. run verification commands,
  8. collect diff; reject protected paths,
  9. commit/push + PR (reuse `WorkspaceManager`/`GitHubService`),
  10. update `pr_url`, post summary message, status `review`,
  11. cleanup (always).
- On failure: post message with stage + error; release ticket; never push a failed diff.
- *Depends on*: Steps 2–4.

### Step 6: Verification runner — `VerificationRunner.java`

- Execute configured commands sequentially in the workspace with a timeout.
- Capture exit code + bounded output (last 8KB).
- Default detection when unset:
  - `package.json` → `npm test`, `npm run lint`, `npm run typecheck` (if scripts exist),
  - `pom.xml` → `mvn test`,
  - `Makefile` → `make test`.
- *Depends on*: Step 1.
- *Tests*: pass/fail/timeout/output truncation/no-command case.

### Step 7: Publishing — extend `WorkspaceManager` + reuse `GitHubService`

- `collectDiff()` → list of changed/added/deleted files + line stats (`git status --porcelain`, `git diff`).
- Protected-path check (Phase 1 hardcoded: `.env*`, `**/secrets/**`, `.github/workflows/**`).
- Commit message `feat: <ticket title> (<ticket id>)`; push branch.
- PR body: ticket summary, files changed, verification evidence, risks.
- Never push when: diff empty, protected path changed, verification failed, or budget exceeded.
- *Depends on*: Step 5.

### Step 8: Agent wiring + feature flag — `AgentApp.java`, `AgentConfig.java`

- `HARNESS_MODE=legacy|opencode` (default `legacy`).
- `AgentApp` constructs either `TicketProcessor` or `HarnessTicketProcessor`.
- New env vars (documented in `AGENTS.md` / README):
  `HARNESS_BIN`, `HARNESS_STARTUP_TIMEOUT_MS`, `HARNESS_IDLE_TIMEOUT_MS`,
  `HARNESS_MAX_DURATION_MINUTES`, `HARNESS_VERIFY_COMMANDS`,
  `HARNESS_PROTECTED_PATHS`, `OPENCODE_CONFIG`, `HARNESS_MODEL`.
- *Depends on*: Step 5.

### Step 9: Agent image — `agent/Dockerfile`

- Base: `eclipse-temurin:17-jre-alpine` (keep) + Node 24 (`nodejs`, `npm`) + `git`, `ripgrep`, `bash`,
  `curl`, `jq`, `python3`, `make`.
- Install pinned `opencode-ai` globally (`npm i -g opencode-ai@<version>`).
- Keep non-root `agent` user; create writable `/repos`, `/tmp/opencode`.
- Healthcheck unchanged.
- *Depends on*: Step 2.

### Step 10: Tests — fake harness server

- `agent/src/test/java/.../harness/FakeOpenCodeServer.java` using `com.sun.net.httpserver` or
  MockWebServer:
  - `/global/health`, `/session`, `/session/:id/message`, `/event` (scripted SSE), `/session/:id/diff`.
- Test classes: `PromptBuilderTest`, `VerificationRunnerTest`, `OpenCodeClientTest`,
  `HarnessTicketProcessorTest`, `PublishingGuardTest`.
- No live model in CI.
- *Depends on*: Steps 2–8.

### Phase 1 exit criteria

- One real ticket on a scratch repo produces a PR.
- Tests green; no pushes on failure/protected paths.
- Feature flag defaults to legacy; documentation updated.

---

## Phase 2 - Human-in-the-loop - 1-2 weeks

**Goal**: questions, permissions, notifications and resume.

### Backend

1. Migration `NNN_agent_harness.sql` (+ rollback):
   - `agent_sessions`, `agent_events`, `ticket_questions`, `notifications`, `agent_policies`,
     `ticket_messages.agent_session_id`.
2. Services:
   - `AgentSessionService` (create/update/heartbeat/events/orphan reconciliation),
   - `QuestionService` (ask/answer/expire/cancel + phase transitions + notifications),
   - `NotificationService` (create/list/mark read),
   - `AgentPolicyService` (Phase 3-ready defaults).
3. Routes + validators + OpenAPI JSDoc:
   - agent endpoints under `/api/v1` with `verifyTokenOrAgent`,
   - human endpoints with JWT + `requireAnyPermission`,
   - answer/notification rate limits.
4. `PhaseService`: allow `planning → blocked`, `blocked → plan_approved`.
5. Tests: unit, integration (ask→answer→phase), bash suite.

### Agent

1. `QuestionBridge`: map OpenCode forms/questions → `POST /tickets/:id/questions`; poll answer;
   reply to form endpoint.
2. `PermissionBridge`: map permission requests → policy engine or question; reply once/always/reject.
3. `SessionReporter`: create/update session, batch events (500ms/20 events), usage.
4. Enable the `question` tool and policy permissions.
5. Resume flow: on startup, find `waiting_human` sessions with answered questions, continue session;
   orphaned sessions → failed.
6. Heartbeat includes session id/current tool/tokens.

### Frontend

1. `api/questions.ts`, `notifications.ts`, `agentSessions.ts`, `agentPolicies.ts`.
2. `stores/notifications.ts` with polling (10s) + unread count.
3. `NotificationBell.vue` in `App.vue`; `/agent-questions` page; question card component.
4. `TicketDetail` Agent tab: status, step, elapsed, tokens/cost, timeline, question card.
5. `PhaseBlocked` embeds question card.
6. Project settings autonomy section (read-only until Phase 3).
7. Vitest + Cypress component/E2E.

### Phase 2 exit criteria

- Agent asks a question; ticket becomes blocked; bell shows unread; answer resumes the session;
  ticket returns to in_progress; answer is auditable.
- Permission requests respect policy and are answerable.
- No duplicate questions; expiry produces an escalation.

---

## Phase 3 - Autonomy, budgets, plan gate, multi-agent - 2-3 weeks

1. **Policy engine** in Java + backend:
   - risk classifier (paths, commands, diff size, migrations/auth/secrets),
   - autonomy modes, protected paths, allow/deny commands, network.
2. **Budget enforcement**:
   - time/tokens/cost/tool calls/files/diff lines; 80% warning; 100% pause + question.
3. **Plan approval gate**:
   - plan session → plan document → auto/human approval → implementation session.
4. **Multi-agent** via OpenCode agents/subagents:
   - architect (read-only) → builder → reviewer (read-only) → fixer,
   - reviewer findings become build input; max 2 review rounds.
5. **Frontend**:
   - policy editor, budget display, plan approval card, agent role badges.
6. Tests for classifier, budgets, plan gate, orchestration.

---

## Phase 4 - Hardening and observability - 1 week

1. Egress allowlist/proxy; read-only rootfs; pids/CPU limits; workspace quota.
2. Event retention/cleanup job (30 days), transcript truncation, secret redaction audit.
3. Metrics: session duration, success rate, questions per ticket, token/cost per ticket,
   blocked time, tool failure rate.
4. Alerting: stuck sessions, repeated failures, budget overruns.
5. Runbooks and operator documentation.

---

### c) Per-File Action Plan (Phase 1 + Phase 2 outline)

#### `agent/src/main/java/com/vibecode/agent/harness/HarnessConfig.java` (CREATE)
- Immutable config record read from env.
- Validation: required binary, positive timeouts, verification list.

#### `agent/src/main/java/com/vibecode/agent/harness/OpenCodeClient.java` (CREATE)
- OkHttp + SSE.
- Methods: `health`, `createSession`, `sendPrompt`, `subscribe`, `getDiff`, `deleteSession`, `close`.
- Redacts `Authorization`/keys from exceptions.

#### `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` (CREATE)
- Mirrors `TicketProcessor` orchestration but delegates to `HarnessClient`.
- Updates heartbeat step values: `cloning`, `starting-harness`, `implementing`, `verifying`,
  `publishing`, `cleanup`.

#### `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java` (CREATE)
- `VerificationResult run(List<String> commands, Path workspace, Duration timeout)`.
- Bounded output; environment sanitized.

#### `agent/src/main/java/com/vibecode/agent/harness/PublishingGuard.java` (CREATE)
- `assertPublishable(Diff diff, List<String> protectedGlobs)`.
- Rejects empty diff, protected paths, oversized diff (policy later).

#### `agent/src/main/java/com/vibecode/agent/AgentApp.java` (MODIFY)
- Choose processor based on `HARNESS_MODE`.
- Keep review mode behavior.

#### `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` (MODIFY)
- Add harness env fields + getters; include in `toString` without secrets.

#### `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java` (MODIFY)
- Add `getRepoDir()`, `collectDiff()`, `runCommand()` helper (or keep commands in VerificationRunner).
- Preserve clone/write/commit/push.

#### `backend/src/migrations/NNN_agent_harness.sql` (CREATE)
- Tables/columns from 02; rollback file.

#### `backend/src/services/QuestionService.js` (CREATE)
- `ask`, `answer`, `expire`, `cancel`, `listForTicket`, `pendingForTicket`.
- Phase transitions via `PhaseService`, notifications via `NotificationService`, messages via `MessageService`.

#### `backend/src/services/AgentSessionService.js` (CREATE)
- Create/update/events/orphan reconciliation.

#### `backend/src/services/NotificationService.js` (CREATE)
- Fan-out to project admins/members; list/mark read.

#### `backend/src/api/agentSessions.js`, `questions` routes, `notifications.js`, `agentPolicies.js` (CREATE)
- Mount in `backend/src/api/v1/index.js` before `/tickets` where needed.

#### `frontend/src/components/NotificationBell.vue` (CREATE)
#### `frontend/src/components/AgentQuestionCard.vue` (CREATE)
#### `frontend/src/views/AgentQuestions.vue` (CREATE)
#### `frontend/src/views/TicketDetail.vue` (MODIFY)
#### `frontend/src/views/phases/PhaseBlocked.vue` (MODIFY)
#### `frontend/src/views/ProjectDetail.vue` (MODIFY)
#### `frontend/src/App.vue` (MODIFY)
#### `frontend/src/router/index.ts` (MODIFY)

---

### d) Dependencies

- Existing agent auth, provider config, heartbeat, GitHub service, workspace manager.
- Existing ticket messages/phases/approvals.
- Docker/PoolManager for agent containers.
- Pinned OpenCode server + provider key.
- New DB tables and APIs (Phase 2).
- Fake harness server for deterministic tests.

---

### e) Risks/Edge Cases

- **OpenCode version drift** → pin + contract fixture.
- **Model does not use tools well** → model allowlist, prompt evaluation, fallback model.
- **Question deadlock** → expiry + notifications + reconciliation.
- **Duplicate sessions after crash** → reconcile by ticket/session status; pickup is atomic.
- **Secrets in logs** → redaction + tests.
- **Protected path edits** → guard blocks publishing; ask human (Phase 2).
- **Flaky tests** → record output; retry once; human override with reason.
- **Windows dev machines** → harness tests use the fake server, no binary requirement.
- **Budget exhaustion** → pause + question, never silently continue.

---

### f) Testing

#### Test-First Requirement

- [ ] Create empty stubs for Phase 1 test files before production code.
- [ ] Fill stubs after implementation.

#### Agent tests
- [ ] `PromptBuilderTest` — ticket/planning/AGENTS/definition-of-done; secret redaction; truncation.
- [ ] `VerificationRunnerTest` — success/failure/timeout/output cap.
- [ ] `PublishingGuardTest` — empty/protected/oversize diff.
- [ ] `OpenCodeClientTest` — health, session, prompt, SSE parse, diff, shutdown.
- [ ] `HarnessTicketProcessorTest` — happy path + failure cleanup + no PR on failure.

#### Backend tests (Phase 2)
- [ ] `questions.test.js` — ask/answer/expire/cancel, phases, 404/403/409, ownership.
- [ ] `agentSessions.test.js` — create/update/events, agent scoping, reconciliation.
- [ ] `notifications.test.js` — fan-out, unread, mark read, isolation.
- [ ] Integration: ask→answer→resume; plan approval; timeout.
- [ ] Bash suite: `harness.test.sh`.

#### Frontend tests (Phase 2)
- [ ] Notification bell, question card, agent tab, policy settings.
- [ ] Cypress component + E2E answer flow.
- [ ] Contract test for new response shapes.

#### CI
- [ ] `mvn test` (fake server).
- [ ] Backend unit/coverage/integration/bash.
- [ ] Frontend unit/coverage/typecheck/build.
- [ ] No real model calls.

---

### g) Migration Notes

Phase 2 migration (tables/columns in 02). Add to `backend/src/migrations/apply.js` in array order,
with `_rollback.sql`. Verify on a fresh database and against an existing one.

---

### h) Files Changed

**Agent**
```
agent/Dockerfile                                      → MODIFY (Node/OpenCode/toolchains)
agent/pom.xml                                         → MODIFY (okhttp-sse, test deps)
agent/src/main/java/com/vibecode/agent/AgentApp.java  → MODIFY
agent/src/main/java/com/vibecode/agent/config/AgentConfig.java → MODIFY
agent/src/main/java/com/vibecode/agent/harness/*      → CREATE
agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java → MODIFY
agent/src/test/java/com/vibecode/agent/harness/*      → CREATE
```

**Backend**
```
backend/src/migrations/NNN_agent_harness.sql          → CREATE
backend/src/migrations/NNN_agent_harness_rollback.sql → CREATE
backend/src/migrations/apply.js                       → MODIFY
backend/src/services/AgentSessionService.js           → CREATE
backend/src/services/QuestionService.js               → CREATE
backend/src/services/NotificationService.js           → CREATE
backend/src/services/AgentPolicyService.js            → CREATE
backend/src/services/PhaseService.js                  → MODIFY
backend/src/api/agentSessions.js                      → CREATE
backend/src/api/notifications.js                      → CREATE
backend/src/api/agentPolicies.js                      → CREATE
backend/src/api/v1/index.js                           → MODIFY
backend/src/validators/agentHarness.js                → CREATE
backend/src/api/openapi-spec.js                       → MODIFY (discovery)
```

**Frontend**
```
frontend/src/api/questions.ts                         → CREATE
frontend/src/api/notifications.ts                     → CREATE
frontend/src/api/agentSessions.ts                     → CREATE
frontend/src/api/agentPolicies.ts                     → CREATE
frontend/src/stores/notifications.ts                  → CREATE
frontend/src/components/NotificationBell.vue          → CREATE
frontend/src/components/AgentQuestionCard.vue         → CREATE
frontend/src/components/AgentTimeline.vue             → CREATE
frontend/src/views/AgentQuestions.vue                 → CREATE
frontend/src/views/TicketDetail.vue                   → MODIFY
frontend/src/views/phases/PhaseBlocked.vue            → MODIFY
frontend/src/views/ProjectDetail.vue                  → MODIFY
frontend/src/App.vue                                  → MODIFY
frontend/src/router/index.ts                          → MODIFY
```

**CI/docs**
```
Jenkinsfile                                           → MODIFY (if new job)
AGENTS.md                                             → MODIFY (env/architecture)
README.md                                             → MODIFY
backend/.env.example                                  → MODIFY
```

---

### Pending Scope Items to Present to User

See 01. Present all ten items before approval.

---

### i) Code Review Checklist

- [ ] Harness cannot push/merge; supervisor publishes.
- [ ] No secrets in config, events, logs, messages, or workspace.
- [ ] Protected paths/commands enforced outside the model.
- [ ] Session/questions/notifications scoped to project.
- [ ] Phase transitions valid and idempotent.
- [ ] Question answer race handled (answered vs expired).
- [ ] Cleanup on every path (server, workspace, temp config).
- [ ] Feature flag and legacy path preserved.
- [ ] Tests deterministic and offline.
- [ ] Coverage ≥60%; docs/env updated.

---

### j) Post-Deploy Verification

1. [ ] `HARNESS_MODE=legacy` still processes a ticket.
2. [ ] `HARNESS_MODE=opencode` processes a scratch ticket and opens a PR.
3. [ ] Verification failure blocks publishing.
4. [ ] Protected path change blocks publishing.
5. [ ] Agent asks a question; bell/question card appears; answer resumes; ticket returns to in_progress.
6. [ ] Question expiry escalates and aborts the session.
7. [ ] Budget threshold pauses with a question.
8. [ ] No secrets in logs/events.
9. [ ] All suites (backend, agent, frontend, bash, E2E) pass.
