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
| 0 | fg-30 (prerequisite sub-phase) | Provider session header, pinned harness version/spec fixture, smoke test |
| 1 | fg-30 | Harness executes a real ticket unattended; verification; PR; feature flag |
| 2 | TBD | Questions, permissions, notifications, UI, resume, sessions/transcripts |
| 3 | TBD | Policies, budgets, plan gate, multi-agent loop |
| 4 | TBD | Sandbox hardening, observability, retention |

Phase 0 is a prerequisite **sub-phase of fg-30**, not part of the Phase 1 spec. It is the only place
where backend provider code (`GenericProvider`) changes. Phase 1 adds the minimal backend lifecycle
sync described in Step 8a; it adds no DB tables and no frontend. Phases 2–4 have no ticket IDs yet.

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
   - Choose an OpenCode version, pin it in `agent/Dockerfile` and add a `HARNESS_VERSION` build arg;
     install that exact version. The pinned version must expose the **V2** HTTP surface
     (`/api/session`, `/api/event`) and the V2 `permissions` array. The earlier `1.19.5` smoke
     validated provider mapping, not the config schema; Phase 0 re-verifies and pins the exact V2
     build. Do not mix V1 `permission` object rules with V2 endpoints.
   - Capture its OpenAPI JSON as a test fixture: fetch `/doc`, follow the OpenAPI JSON link it advertises
     (current versions expose `/v2/openapi.json`), and save it as
     `agent/src/test/resources/opencode-openapi-<version>.json`. `/doc` itself is an HTML page, not raw
     JSON, so the extraction script (`agent/scripts/fetch-opencode-spec.ps1`/`.sh`) must parse the link.
   - Also capture the resolved config schema (`opencode debug config` or the pinned JSON schema) and
     assert it uses `permissions` (V2), not the V1 `permission` object.
   - Contract tests assert the paths the client uses exist in the fixture:
     `POST /api/session`, `POST /api/session/{sessionID}/prompt`, `GET /api/event`,
     `GET /api/session/{sessionID}/diff`,
     `POST /api/session/{sessionID}/permission/{requestID}/reply`,
     `POST /api/session/{sessionID}/form/{formID}/reply`.
   - Do **not** use the deprecated `POST /session/:id/permissions/:permissionID`. If the pinned version
     lacks a v2 path, stop and update the pin and fixture before writing the client.
   - *Depends on*: nothing.

3. **Provider smoke test**
   - Manually run `opencode serve` with the chosen provider/model and a tiny session in a scratch repo.
   - Record the config shape that works (provider block, model id, permissions).
   - *Depends on*: Step 2.

4. **OpenCode Go session header (prerequisite for legacy provider paths)**
   - OpenCode Go requires `x-opencode-session` on every request; direct calls return
     `400 MissingSessionID` without it.
   - The harness (OpenCode server or the Phase 1 `ProviderProxy`) sends this automatically, but the
     planner's `GenericProvider` and the Java `OpenAiCompatibleProvider` do not.
   - Add an optional session-header setting to both providers (or detect the
     `opencode.ai/inference/go` base URL) so the existing provider test and legacy agent can use
     the same key. This is the **only backend provider change**, and it belongs to Phase 0.
   - *Depends on*: Step 3.

---

## Phase 1 — Harness foundation (fg-30) — 1–2 weeks

**Goal**: a backlog ticket is implemented, verified and published as a PR by OpenCode, with no human
interaction. Questions are disabled in this phase (the model must make assumptions).

### Step 1: Harness config and interface — `agent/src/main/java/com/vibecode/agent/harness/`

- Create `HarnessConfig.java` (04 is canonical):
  - mode (`legacy`/`opencode`), binary, startup timeout, idle timeout, max duration,
    verification commands, protected paths, bash allowlist, permission mode (`unattended`),
    model override.
  - Read from env with defaults; validate (including rejecting `ask`). The workspace is passed to
    `HarnessClient.start(Path)`, not stored in `HarnessConfig`.
- Create `HarnessClient.java` interface, exactly matching 04:
  - `void start(Path workspace)`
  - `String createSession(String title)`
  - `void subscribe(sessionId, Consumer<HarnessEvent> listener)` (call **before** the prompt)
  - `void awaitSubscribed(Duration timeout)` (wait for SSE to be live)
  - `void sendPromptAsync(sessionId, prompt)` (`POST /api/session/:id/prompt`)
  - `void replyPermission(sessionId, permissionId, reply)` (used for the Phase 1 auto-reject safety
    path and the Phase 2 bridge)
  - `DiffSummary getDiff(sessionId)`
  - `boolean isHealthy()`
  - `void close()`
  - `StartResult`/`Diff` are **not** separate types; use `void` and `DiffSummary` as in 04.
- Create `HarnessEvent.java` (sealed/record types for tool, message, idle, error).
- *Depends on*: Phase 0.

### Step 2: OpenCode server client — `agent/src/main/java/com/vibecode/agent/harness/OpenCodeClient.java`

- Start `opencode serve` with:
  - random free port, `--hostname 127.0.0.1`,
  - `OPENCODE_SERVER_PASSWORD` random per run,
  - `OPENCODE_CONFIG` pointing to a temp config outside the workspace,
  - `HOME` pointing to a per-run temp directory,
  - no provider key in the environment or config; the config points at `ProviderProxy`.
- Health poll `/global/health` with timeout/backoff.
- Create session: `POST /api/session`.
- **Subscribe before prompting**: open `GET /api/event` (SSE) and wait for the subscription to be
  established, then call `POST /api/session/:id/prompt` (async). Never use the blocking
  `/api/session/:id/message` path.
- Permission events: Phase 1 replies `reject` automatically (no `ask` expected); Phase 2 uses the
  policy bridge. Use `POST /api/session/:id/permission/:requestID/reply`.
- Diff: `GET /api/session/:id/diff` or `git diff` fallback.
- Stop: delete session, terminate process, stop `ProviderProxy`, delete temp config/home.
- *Depends on*: Step 1.
- *Tests*: fake HTTP/SSE server, including a timing test that emits tool/idle events immediately after
  `prompt` and proves the client already subscribed.

### Step 3: Temporary OpenCode config — `HarnessConfigWriter.java`

- Render `opencode.json` with the **V2 config schema only** (the same generation as the
  `/api/session` endpoints):
  - provider/model mapping pointed at `http://127.0.0.1:<proxy-port>/v1` with a per-run
    `ProxySettings` (dummy proxy token, no real key); set
    `options.headers["X-Vibecode-Proxy-Token"]` and also pass the same token as `apiKey` so the proxy
    can accept `Authorization: Bearer <proxyToken>` if custom headers are unsupported,
  - `permissions` array, ordered so the last match wins and **no rule resolves to `ask`**:
    - `{action:"*", resource:"*", effect:"deny"}` first (unknown tools denied),
    - `read` allow `*`, then deny `*.env`, `*.env.*`, `**/secrets/**`, `**/*.pem`, `**/*.key`,
      `**/id_rsa*`, `.git/**`; keep `*.env.example` allow after the deny,
    - `edit` allow `*`, then deny the same plus `.github/workflows/**`, `backend/src/migrations/**`,
      `backend/src/middleware/auth*`, `backend/src/services/UserService.js`,
      `backend/src/validators/auth*`,
    - `glob` allow `*`; `grep` allow `*` (secret files are physically removed),
    - `shell` deny `*`, then allow only `git status *`, `git branch --show-current`,
      `ls *`, `pwd`, `rg *`, `find *`, `npm test *`, `npm run lint *`, `npm run typecheck *`,
      `npm run build *`, `npx vitest run *`, `npx jest *`, `mvn test *`, `./mvnw test *`,
      `pytest *`, `python -m pytest *`, `make test *`, `go test *`, `cargo test *`.
      **Do not allow `git log`, `git show`, `git diff`, or any history/content command.**
    - `question`, `webfetch`, `websearch`, `subagent`, `external_directory`, `execute`: deny.
  - instructions/AGENTS.md references,
  - optional formatter/LSP settings.
- `validateUnattended()` parses the `permissions` array and throws if any `effect` is `ask`; it also
  throws if the V1 `permission` object shape is detected.
- Write outside the workspace (temp dir), mode 0600, delete after run.
- Never log the API key; redact errors.
- *Depends on*: Step 2.

### Step 3a: Secure workspace — `WorkspaceSanitizer.java`, `WorkspaceManager` changes

- Clone with `--depth 1 --single-branch` and
  `git -c http.extraHeader="Authorization: Basic <base64(x-access-token:PAT)>"`; never embed the token
  in the URL and never `git remote set-url origin <authenticatedUrl>`.
- After clone and before server start: remove `origin` (or reset it to the unauthenticated URL), delete
  `.env`, `.env.*` (keep `.env.example`), `**/secrets/**`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, and any
  token-bearing config; keep the removed-path list and pass it to `PublishingGuard`, which blocks any
  diff touching those paths even if they are outside the protected globs; verify `.git/config` has no
  `http.extraheader`/token.
- Supervisor `commitAndPush` uses the same one-shot header; no token is persisted.
- After sanitising, the supervisor runs a bounded dependency bootstrap (`npm ci` with a lockfile,
  `pip install -r requirements.txt`, or `mvn -q -DskipTests dependency:go-offline`). The agent's bash
  allowlist does not include installs; bootstrap failures are reported before the model starts.
- Add `WorkspaceSanitizerTest` and a test that `git remote -v`/`.git/config` contains no PAT.
- *Depends on*: Step 2.

### Step 3b: Provider proxy and redaction — `ProviderProxy.java`, `SecretRedactor.java`

- `ProviderProxy` binds to `127.0.0.1:0`, requires a per-run `X-Vibecode-Proxy-Token` (or
  `Authorization: Bearer <proxyToken>`, or for Claude `x-api-key: <proxyToken>`, as fallbacks),
  rejects non-loopback peers, strips client auth, and injects provider-specific headers:
  `Authorization` for OpenAI/Go, `x-opencode-session` for Go, and `x-api-key` + `anthropic-version`
  for Claude. The real key exists only in the supervisor's memory.
- `SecretRedactor` removes known secret values and token-shaped patterns from messages, events, logs
  and exceptions. Apply it in `ApiService` posting paths and `OpenCodeClient` error handling.
- Tests: dummy key works, real key never appears in harness config; fake output with `ghp_...`,
  `github_pat_...`, `oc_sk_...`, `sk-...`, `Bearer ...` is redacted.
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
  1. pick up ticket (via `TicketLifecycleService`, atomic phase+status),
  2. clone repo + branch (tokenless),
  3. sanitise workspace; start `ProviderProxy`; start server + session,
  4. **subscribe to events first**, then send the async prompt,
  5. consume events → heartbeat `current_step`, log progress; auto-reject unexpected permissions,
  6. wait for idle/error with wall-clock timeout,
  7. run verification commands (Jest/Vitest-aware detection),
  8. collect diff; reject protected paths; redact output,
  9. commit/push + PR (reuse `WorkspaceManager`/`GitHubService`, one-shot auth header),
  10. update `pr_url`, post redacted summary, transition to `review` (phase+status atomically),
  11. cleanup (always: proxy, server, workspace, temp config).
- On failure: post message with stage + error; release ticket; never push a failed diff.
- *Depends on*: Steps 2–4.

### Step 6: Verification runner — `VerificationRunner.java`

- Execute configured commands sequentially in the workspace with a timeout.
- Capture exit code + bounded output (last 8KB).
- Default detection when unset:
  - `package.json`: inspect `scripts.test` and devDependencies/config.
    - Jest (`jest`, `jest.config.*`) → `npm test` (optionally `npm test -- --runInBand`); **never**
      append `--run`, which is Vitest-only and would break this backend.
    - Vitest (`vitest`, `vitest.config.*`) → `npm test -- --run`.
    - If neither is detectable, use the script verbatim and record it; do not guess a flag.
  - `scripts.lint` → `npm run lint`; `scripts.typecheck` → `npm run typecheck` (only if present).
  - `pom.xml` → `mvn test -q`; `./mvnw` → `./mvnw test -q`.
  - `Makefile` with a `test` target → `make test`.
  - Unknown stack and no `HARNESS_VERIFY_COMMANDS` → fail with a clear "no verification commands"
    error rather than publishing unverified code.
- *Depends on*: Step 1.
- *Tests*: pass/fail/timeout/output truncation/no-command case.

### Step 7: Publishing — extend `WorkspaceManager` + reuse `GitHubService`

- `collectDiff()` → list of changed/added/deleted files + line stats (`git status --porcelain`, `git diff`).
- Protected-path check (Phase 1 hardcoded: `.env*`, `**/secrets/**`, `**/*.pem`, `**/*.key`,
  `**/id_rsa*`, `.git/**`, `.github/workflows/**`, `backend/src/migrations/**`,
  `backend/src/middleware/auth*`, `backend/src/services/UserService.js`,
  `backend/src/validators/auth*`).
- Commit message `feat: <ticket title> (<ticket id>)`; push branch with a one-shot auth header.
- PR body: ticket summary, files changed, verification evidence, risks; all text redacted.
- Never push when: diff empty, protected path changed, verification failed, or budget exceeded.
- On failure, **release to `backlog`** in Phase 1 via `TicketLifecycleService` (no status-only
  update). `blocked` is reserved for the Phase 2 human-question loop.
- *Depends on*: Step 5.

### Step 8: Agent wiring + feature flag — `AgentApp.java`, `AgentConfig.java`

- `HARNESS_MODE=legacy|opencode` (default `legacy`).
- `AgentApp` constructs either `TicketProcessor` or `HarnessTicketProcessor`.
- New env vars (documented in `AGENTS.md` / README):
  `HARNESS_BIN`, `HARNESS_STARTUP_TIMEOUT_MS`, `HARNESS_IDLE_TIMEOUT_MS`,
  `HARNESS_MAX_DURATION_MINUTES`, `HARNESS_VERIFY_COMMANDS`,
  `HARNESS_PROTECTED_PATHS`, `HARNESS_BASH_ALLOWLIST`, `HARNESS_PERMISSION_MODE`,
  `HARNESS_PROXY_TOKEN`, `OPENCODE_CONFIG`, `HARNESS_MODEL`.
- *Depends on*: Step 5.

### Step 8a: Backend lifecycle sync — `TicketLifecycleService.js`, `PhaseService.js`, `TicketService.js`, `models/ticket.js`

- Add `backlog` as an explicit phase (`ALLOWED_TRANSITIONS` + `PHASE_TO_STATUS` +
  `BACKLOG_COMPATIBLE_PHASES`).
- `TicketLifecycleService.pickUp` accepts legacy `draft`, `planning`, `plan_approved` and `assigned`
  phases as well as `backlog`, and normalises them to `in_progress` in one transaction. This keeps
  pre-existing tickets working even before the backfill runs.
- Add an idempotent data migration `045_backfill_backlog_phase.sql`:
  `UPDATE tickets SET phase='backlog' WHERE status='backlog' AND phase='draft';` plus rollback, and
  register it in `apply.js`. This is data-only; no schema change.
- Change `Ticket.create()` to insert `phase='backlog'` for new backlog tickets (and keep `fromRow`
  backward compatible).
- `TicketLifecycleService` methods (`pickUp`, `release`, `markReview`, `block`, `resume`) update
  assignment, `phase`, `status` and `ticket_phases` in one transaction.
- `TicketService.pickUpTicket/releaseTicket` delegate to it; the harness never calls status-only
  updates.
- Tests cover pickup/release/review/block, a **pre-existing `phase='draft'` ticket**,
  `BACKLOG_COMPATIBLE_PHASES` including `backlog`, and assert `status` and `phase` never diverge.
- *Depends on*: Step 5.

### Step 9: Agent image — `agent/Dockerfile`

- Base: **`eclipse-temurin:17-jre-jammy` (glibc)**, not Alpine. OpenCode ships a glibc Linux binary;
  musl compatibility is not guaranteed. Copy Node 24 from `node:24-bookworm-slim` (binary + lib) or
  install NodeSource; add `git`, `ripgrep`, `bash`, `curl`, `jq`, `python3`, `make`.
- `ARG HARNESS_VERSION` and install exactly `npm i -g opencode-ai@${HARNESS_VERSION}`; assert
  `opencode --version` matches at build time and `ldd $(which opencode)` resolves on glibc.
- Keep non-root `agent` user; create writable `/repos`, `/tmp/opencode`.
- Healthcheck unchanged.
- If the pinned binary turns out to be musl-only, switch the base to Alpine and document it; do not mix
  a musl binary with a glibc base.
- *Depends on*: Step 2.

### Step 10: Tests — fake harness server

- `agent/src/test/java/.../harness/FakeOpenCodeServer.java` using `com.sun.net.httpserver` or
  MockWebServer:
  - `/global/health`, `/api/session`, `/api/session/:id/prompt`, `/api/event` (scripted SSE),
    `/api/session/:id/diff`, `/api/session/:id/permission/:requestID/reply`.
  - A "fast events" mode that emits tool/idle immediately after prompt, to prove the client subscribed
    first.
- Test classes: `PromptBuilderTest`, `VerificationRunnerTest`, `OpenCodeClientTest`,
  `HarnessTicketProcessorTest`, `PublishingGuardTest`, `PermissionPolicyTest`,
  `WorkspaceSanitizerTest`, `ProviderProxyTest`, `SecretRedactorTest`.
  Include V2 config-shape, Claude `x-api-key`, shallow-history, and
  `X-Vibecode-Proxy-Token` assertions.
- Backend: `TicketLifecycleSyncTest` (including a pre-existing `phase='draft'` ticket), backfill test,
  and lifecycle tests in the existing ticket/phase suites.
- No live model in CI.
- *Depends on*: Steps 2–8.

### Phase 1 exit criteria

- One real ticket on a scratch repo produces a PR with **no permission prompt**.
- Tests green; no pushes on failure/protected paths; no PAT/key in workspace/logs/messages.
- Phase and status stay synchronised on pickup, failure, release and review. Phase 1 never leaves a
  ticket in `blocked` (that state belongs to the Phase 2 question loop).
- Feature flag defaults to legacy; documentation updated.

---

## Phase 2 - Human-in-the-loop - 1-2 weeks

**Goal**: questions, permissions, notifications and resume.

### Backend

1. Migration `NNN_agent_harness.sql` (+ rollback):
   - `agent_sessions`, `agent_events`, `ticket_questions`, `notifications`, `agent_policies`,
     `ticket_messages.agent_session_id`;
   - `agent_heartbeats.agent_session_id/current_tool/tokens_in/tokens_out/cost_usd`;
   - `agent_sessions.resumed_from_session_id/resume_mode`;
   - unique indexes `uq_agent_sessions_external` and `uq_ticket_questions_external`.
2. Services:
   - `AgentSessionService` (create/update/heartbeat/events/orphan reconciliation, list by ticket),
   - `QuestionService` (ask/answer/expire/cancel + phase transitions + notifications, idempotent ask),
   - `NotificationService` (create/list/mark read),
   - `AgentPolicyService` (Phase 3-ready defaults).
3. Routes + validators + OpenAPI JSDoc:
   - agent endpoints under `/api/v1` with `verifyTokenOrAgent`,
   - human endpoints with JWT + `requireAnyPermission`,
   - `GET /agent-sessions?ticketId=` and `GET /tickets/:ticketId/agent-sessions`,
   - extend `POST /agents-status/:id/heartbeat` with the new optional fields,
   - answer/notification rate limits.
4. `PhaseService`: allow `planning → blocked`, `blocked → plan_approved`.
5. Tests: unit, integration (ask→answer→phase), idempotency/replay, bash suite.

### Agent

1. `QuestionBridge`: map OpenCode forms/questions → `POST /tickets/:id/questions`; poll answer;
   reply to form endpoint.
2. `PermissionBridge`: map permission requests → policy engine or question; reply once/always/reject.
3. `SessionReporter`: create/update session, batch events (500ms/20 events), usage.
4. Enable the `question` tool and policy permissions.
5. Resume flow: on startup, find `waiting_human` sessions with answered questions. If the original
   OpenCode session is still alive, use `resume_mode='continue'`; otherwise start a **fresh session in
   the same workspace** with `resume_mode='fresh'`, `resumed_from_session_id`, the answer, the current
   diff/status and a summary of the prior session. Orphaned sessions → failed; unanswered questions
   stay pending.
6. Heartbeat includes session id/current tool/tokens/cost; `PATCH /agent-sessions/:id` is the source of
   truth and also updates the heartbeat row.

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
- No duplicate questions or sessions on event replay (unique indexes + upserts).
- The Agent tab finds the active session through the ticket/session list endpoint; heartbeat shows
  session id, tool, tokens and cost.
- A restart resumes with an explicit `continue` or `fresh` mode and the answer in the prompt.
- Expiry produces an escalation.

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
- Methods: `health`, `createSession`, `subscribe`, `awaitSubscribed`, `sendPromptAsync`,
  `replyPermission`, `getDiff`, `deleteSession`, `close`.
- Redacts `Authorization`/keys from exceptions.

#### `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` (CREATE)
- Mirrors `TicketProcessor` orchestration but delegates to `HarnessClient`.
- Updates heartbeat step values: `cloning`, `starting-harness`, `implementing`, `verifying`,
  `publishing`, `cleanup`.

#### `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java` (CREATE)
- `VerificationResult run(List<String> commands, Path workspace, Duration timeout)`.
- Bounded output; environment sanitized.

#### `agent/src/main/java/com/vibecode/agent/harness/PublishingGuard.java` (CREATE)
- `PublishingGuard(List<String> protectedGlobs, List<String> sanitizerRemovals)`.
- `assertPublishable(DiffSummary diff)` rejects empty diff, protected paths, **any sanitizer-removed
  path present in the diff** (even outside protected globs), and oversized diff (policy later).

#### `agent/src/main/java/com/vibecode/agent/AgentApp.java` (MODIFY)
- Choose processor based on `HARNESS_MODE`.
- Keep review mode behavior.

#### `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` (MODIFY)
- Add harness env fields + getters; include in `toString` without secrets.

#### `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java` (MODIFY)
- Add `getRepoDir()`, `collectDiff()`, `runCommand()` helper (or keep commands in VerificationRunner).
- **Replace token-in-URL clone** with a one-shot `http.extraHeader`; do not persist the PAT in
  `.git/config`; remove/reset `origin` before the harness starts; push with the same header.
- Add `WorkspaceSanitizer` invocation before the harness starts.

#### `agent/src/main/java/com/vibecode/agent/harness/WorkspaceSanitizer.java` (CREATE)
- Remove `.env*` (except `.env.example`), secrets, key files and token-bearing git config; verify.

#### `agent/src/main/java/com/vibecode/agent/harness/ProviderProxy.java` (CREATE)
- Loopback-only, per-run token, injects the real provider auth/session header; the harness gets a dummy key.

#### `agent/src/main/java/com/vibecode/agent/harness/SecretRedactor.java` (CREATE)
- Redact known values and token-shaped patterns from messages, events, logs and errors.

#### `backend/src/services/TicketLifecycleService.js` (CREATE, Phase 1)
- Atomic pickup/release/review/block/resume: assignment + phase + status + phase history.

#### `backend/src/services/PhaseService.js`, `backend/src/services/TicketService.js` (MODIFY, Phase 1)
- Add `backlog` phase; delegate lifecycle changes to `TicketLifecycleService`; no status-only drift.

#### `backend/src/api/v1/agentHeartbeat.js`, `backend/src/services/HeartbeatService.js` (MODIFY, Phase 2)
- Optional session/tool/token/cost fields; session updates project into the heartbeat row.

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
- **Protected path edits** → guard blocks publishing and releases (Phase 1); ask human in Phase 2/3.
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
- [ ] `VerificationRunnerTest` — success/failure/timeout/output cap; Jest vs Vitest detection.
- [ ] `PublishingGuardTest` — empty/protected (incl. auth/migrations/pem/key/id_rsa/.git),
  sanitizer-removal paths, and oversize diff.
- [ ] `OpenCodeClientTest` — health, session, async prompt, subscribe-before-prompt timing, SSE parse,
      permission reply/auto-reject, diff, shutdown.
- [ ] `PermissionPolicyTest` — no `ask` values, safe bash allowlist, deny list, auto-reject.
- [ ] `WorkspaceSanitizerTest` — `.env*`/secrets/git credentials removed; `.env.example` kept.
- [ ] `ProviderProxyTest` — loopback-only, dummy token, real key isolated, session header forwarded.
- [ ] `SecretRedactorTest` — PAT/key/bearer shapes removed from messages/events/errors.
- [ ] `HarnessTicketProcessorTest` — happy path + failure cleanup + no PR on failure + redacted output.
- [ ] Backend `TicketLifecycleSyncTest` — status/phase atomic on pickup/release/review/block.

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

Phase 1 adds only the data backfill `045_backfill_backlog_phase.sql` (+ rollback), registered in
`apply.js`; it is idempotent and safe to re-run.

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
agent/src/main/java/com/vibecode/agent/harness/*      → CREATE (incl. ProviderProxy, SecretRedactor, WorkspaceSanitizer)
agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java → MODIFY (tokenless clone/push)
agent/src/test/java/com/vibecode/agent/harness/*      → CREATE
agent/scripts/fetch-opencode-spec.sh|ps1               → CREATE (fixture extraction)
agent/src/test/resources/opencode-openapi-<version>.json → CREATE (pinned spec)
agent/Dockerfile                                      → MODIFY (glibc + HARNESS_VERSION)
agent/src/main/java/com/vibecode/agent/service/OpenAiCompatibleProvider.java → MODIFY (Phase 0 session header)
```

**Backend**
```
backend/src/migrations/045_backfill_backlog_phase.sql → CREATE (Phase 1 data backfill)
backend/src/migrations/045_backfill_backlog_phase_rollback.sql → CREATE
backend/src/migrations/NNN_agent_harness.sql          → CREATE (Phase 2)
backend/src/migrations/NNN_agent_harness_rollback.sql → CREATE (Phase 2)
backend/src/migrations/apply.js                       → MODIFY (register 045 + Phase 2)
backend/src/models/ticket.js                          → MODIFY (Phase 1: create phase backlog)
backend/src/services/TicketLifecycleService.js        → CREATE (Phase 1)
backend/src/services/PhaseService.js                  → MODIFY (Phase 1: backlog phase)
backend/src/services/TicketService.js                 → MODIFY (Phase 1: delegate pickup/release)
backend/src/services/AgentSessionService.js           → CREATE (Phase 2)
backend/src/services/QuestionService.js               → CREATE (Phase 2)
backend/src/services/NotificationService.js           → CREATE (Phase 2)
backend/src/services/AgentPolicyService.js            → CREATE (Phase 2)
backend/src/services/HeartbeatService.js              → MODIFY (Phase 2: session/tool/tokens)
backend/src/api/agentSessions.js                      → CREATE (Phase 2, incl. list by ticket)
backend/src/api/notifications.js                      → CREATE (Phase 2)
backend/src/api/agentPolicies.js                      → CREATE (Phase 2)
backend/src/api/v1/agentHeartbeat.js                  → MODIFY (Phase 2 schema)
backend/src/api/v1/index.js                           → MODIFY
backend/src/validators/agentHarness.js                → CREATE
backend/src/api/openapi-spec.js                       → MODIFY (discovery)
backend/src/providers/generic/index.js                → MODIFY (Phase 0 session header)
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

- [ ] Harness cannot push/merge; supervisor publishes with a one-shot auth header.
- [ ] No PAT in `.git/config`; no provider key readable by the harness; no secrets in config, events,
      logs, messages or workspace.
- [ ] Phase 1 uses the V2 `permissions` array only; no `ask`; safe shell allowlist and deny list;
      unexpected permission auto-rejected.
- [ ] Subscribe happens before the async prompt; fast-event test proves no events are missed.
- [ ] Clone is shallow/tokenless; `git log`/`git show`/`git diff` are denied; removed tracked secrets
      cannot be published.
- [ ] Protected paths/commands enforced outside the model (auth, migrations, workflows, secrets).
- [ ] Session/questions/notifications scoped to project; session list finds the active session.
- [ ] Phase transitions valid, atomic with status, and idempotent (unique external IDs).
- [ ] Question answer race handled (answered vs expired).
- [ ] Cleanup on every path (server, workspace, temp config).
- [ ] Feature flag and legacy path preserved.
- [ ] Tests deterministic and offline.
- [ ] Coverage ≥60%; docs/env updated.

---

### j) Post-Deploy Verification

1. [ ] `HARNESS_MODE=legacy` still processes a ticket.
2. [ ] `HARNESS_MODE=opencode` processes a scratch ticket unattended and opens a PR (no permission prompt).
3. [ ] Verification failure blocks publishing.
4. [ ] Protected path change blocks publishing; no token in `.git/config` or logs.
5. [ ] Phase/status match after pickup, failure, release and review.
6. [ ] Agent asks a question; bell/question card appears; answer resumes; ticket returns to in_progress.
7. [ ] Question expiry escalates and aborts the session.
8. [ ] Budget threshold pauses with a question.
9. [ ] No secrets in logs/events; no PAT in `.git/config`.
10. [ ] All suites (backend, agent, frontend, bash, E2E) pass.
