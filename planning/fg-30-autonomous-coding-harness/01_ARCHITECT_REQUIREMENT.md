# 01_ARCHITECT_REQUIREMENT.md — Autonomous Coding Harness

**Status**: planned
**Date created**: 2026-10-31
**Date completed**: —
**Author**: AI Assistant
**Scope**: Both (Java agent, backend, frontend, agent image, infrastructure)
**Priority**: P1
**Effort**: Large

---

## Requirement

Replace the current one-shot ticket processor with an autonomous coding harness that can work the
way a human coding agent does:

1. **Understand** the ticket, the planning documents, the repository conventions and the existing code.
2. **Plan** the change, then **execute** with real tools: read files, search the repo, apply precise
   edits, create files, run tests/lint/typecheck, and iterate on failures.
3. **Verify** the result against tests and acceptance criteria before publishing anything.
4. **Publish** only as a branch + pull request. Agents never merge and never push to the default branch.
5. **Escalate** when genuinely blocked or when it needs a decision: post a question to the ticket,
   transition the ticket to a waiting state, notify the human, pause, and resume automatically when
   the human answers.
6. **Report** progress and evidence: current step, tool activity, test results, diff summary, token/cost usage.

The value: humans plan and review; agents do the majority of implementation. Human attention is only
required for ambiguity, risky decisions, plan approval and final review.

### Why the current agent cannot do this

`agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java`:

- Sends the model the ticket + planning docs + a **list of file paths only** (`WorkspaceManager.getRepoFileList()`).
- Expects the model to return a JSON `{files:[{path,content,action}]}` object with complete file bodies.
- Cannot read existing file contents, so it must guess when modifying anything.
- Cannot run commands or tests; it writes files blindly, commits, pushes and opens a PR.
- Has no mid-task question mechanism. Failures release the ticket back to backlog.
- Has no iteration loop, no test feedback, no diff review, and no autonomy policy.

This ticket replaces that with a harness-driven loop while preserving the planner's ticket, planning,
phase, approval, usage and audit model.

---

## Existing Infrastructure Audit

### Agent (Java)

| Capability | Exists? | Location | Notes |
|---|---|---|---|
| Polling loop / ticket pickup | YES | `AgentApp.java`, `ApiService.java` | Reusable |
| Heartbeat + current step | YES | `AgentApp.start()`, `ApiService.sendHeartbeat()` | Reusable; extend with session id/tool |
| Provider config resolution | YES | `AgentApp.createAiProvider()`, backend `/agents/:id/provider-config` | Reusable; add OpenCode config mapping |
| Prompt construction | PARTIAL | `TicketProcessor.buildSystemPrompt()` | Replace with harness prompt builder |
| Repo clone / branch | YES | `WorkspaceManager.cloneRepo()` | Reusable |
| File writing / commit / push | YES | `WorkspaceManager.writeFiles()/commitAndPush()` | Commit/push moves to supervisor |
| PR creation | YES | `GitHubService.createPullRequest()` | Reusable |
| Review processor | YES | `ReviewProcessor.java` | Keep; later becomes a reviewer agent |
| Human questions | NO | — | New |
| Tool loop / command execution | NO | — | New harness |
| Agent session/transcript | NO | — | New |

### Backend (Node)

| Capability | Exists? | Location | Notes |
|---|---|---|---|
| Tickets + phases + transitions | YES | `api/tickets.js`, `PhaseService.js` | `blocked` phase already exists |
| Ticket messages | YES | `MessageService.js`, `api/tickets.js` | `message_type` is free-form varchar |
| Approvals | YES | `ApprovalService.js`, `approvals.js` | Final "done" approval only |
| Agent auth + heartbeats | YES | `middleware/auth.js`, `api/v1/agentHeartbeat.js` | Extend |
| Agent provider config | YES | `ProviderService.js`, `api/agents.js` | Reusable |
| Agent pools / compute nodes | YES | `PoolManager.js`, `ProvisioningService.js` | Extend env forwarding |
| Questions waiting on a human | NO | — | New table + API |
| Notifications / alerts | NO | — | New table + API + UI |
| Agent session/event persistence | NO | — | New tables + API |
| Autonomy policies / budgets | NO | — | New table + API |

### Frontend (Vue)

| Capability | Exists? | Location | Notes |
|---|---|---|---|
| Ticket detail | YES | `views/TicketDetail.vue` | Add Agent tab / question card |
| Phase flow | YES | `views/PhaseFlow.vue`, `views/phases/*` | `PhaseBlocked.vue` is the natural question surface |
| Approvals queue | YES | `views/ApprovalsQueue.vue` | Final approvals; questions get their own inbox |
| Notifications bell | NO | — | New |
| Agent messages display | NO | — | Messages exist in the API but are not rendered |
| Autonomy settings | NO | — | New section in project settings |

### Key Insight

The **backend ticket/phase/message/approval model already supports most of the control plane**. What is
missing is (a) a real execution harness, (b) a persistent human-question loop, and (c) notifications/UI.
The recommended approach is to **adopt the OpenCode server as the execution engine** and keep the planner
as the control plane. See `02_ARCHITECT_DESIGN.md` for alternatives.

---

## Scope

### In Scope

- Harness supervisor in the Java agent that launches and controls an OpenCode server per ticket.
- Sandboxed workspace, provider/model mapping, permissions, prompts, event streaming.
- Full tool loop: read/search/edit/write/run tests/iterate, with real repository context.
- Branch + PR publishing controlled by the supervisor (agents never merge or push to main).
- Persistent agent sessions and event/transcript storage.
- Human-in-the-loop:
  - Agent question tool → ticket question → notification → human answer → agent resume.
  - Permission requests (risky operations) routed through policy or human approval.
  - Ticket phase `blocked` while waiting; automatic return to `in_progress` on answer.
- In-app notification bell + question inbox + ticket question cards.
- Autonomy policies and budgets (time, tokens, cost, changed files, risky paths).
- Risk-based plan approval gate.
- Feature flag with legacy fallback.
- Tests at every layer, including a fake harness server for deterministic CI.

### Out of Scope

- Merging PRs automatically (humans always merge).
- Replacing the planner's ticket / planning / approval model.
- Email/Slack notifications (in-app MVP; channel adapters are a follow-up).
- Multi-repository tickets.
- Running arbitrary target-project languages without a matching toolchain in the agent image.
- Full multi-agent organisation (architect + builder + reviewer) in Phase 1; phased after the single-agent loop is stable.
- Migrating existing in-progress tickets automatically.

---

## Pending Scope Items to Present to User

A scan of previous tickets' "Out of Scope" sections found these relevant deferred items:

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | bp-120 | Agent connectivity fixes (double-wrapped provider config, heartbeat listing, Java defensive parsing) — prerequisite for reliable harness provider config | Agent | `bp-120-agent-connectivity-fixes` | Yes (PR #101) |
| 2 | bp-121 | Agent IP/CORS/whitelist support for non-localhost agents — needed for remote harness nodes | Agent / Security | `bp-121-agent-connectivity-ip` | Yes (PR #101) |
| 3 | bp-71 | Email notification on account lockout — reuse the notification channel for agent questions | Security / UX | `bp-71-email-notifications` | Yes (PR #101) |
| 4 | bp-74 | API key rotation/expiry — extend to harness session credentials | Security | `bp-74-session-credentials` | Yes (PR #101) |
| 5 | bp-14 | S3 storage for planning artifacts — harness needs planning docs from a stable store | Infrastructure | `bp-14-s3-planning-storage` | Yes (PR #101) |
| 6 | bp-53 | Distributed state/cache — active harness sessions across replicas | Infrastructure | `bp-53-harness-session-state` | Yes (PR #101) |
| 7 | bp-106 | Log aggregation — ship harness event streams to the aggregation pipeline | Observability | `bp-106-harness-event-shipping` | Yes (PR #101) |
| 8 | bp-04 | Usage/billing — per-ticket budget alerts and real-time cost dashboard for harness runs | Observability / Billing | `bp-04-harness-budgets` | Yes (PR #101) |
| 9 | fg-13 | FE↔BE contract inconsistencies — new question/notification/session APIs must update `validator.ts` and the contract test | Testing | `fg-13-contract-followup` | Yes (PR #101) |
| 10 | bp-99 | Cypress E2E suite is stale and not in Jenkins — new question/notification flows need E2E coverage | Testing | `bp-99-e2e-harness-ui` | Yes (PR #101) |

**All items above must be presented to the user before ticket approval.** They are presented in the
PR #101 description and in a dedicated PR comment so the user can accept or defer each one. The
`User Notified` column is updated to `Yes (PR #101)` after that comment is posted.

### Deferred Improvements Found (Internal Tracking)

Same list; follow-up directories to be created when the harness foundation is merged.

---

## Impact Analysis

| Component | Change Type | Details |
|---|---|---|
| `agent/src/main/java/com/vibecode/agent/` | CREATE/MODIFY | Harness package, config, supervisor, prompt builder, event bridge |
| `agent/Dockerfile` | MODIFY | Node 24 + OpenCode CLI/server + common toolchains |
| `backend/src/services/` | CREATE | `AgentSessionService`, `QuestionService`, `NotificationService`, `AgentPolicyService` |
| `backend/src/api/` | CREATE/MODIFY | Sessions/questions/notifications/policies routes + agent auth |
| `backend/src/migrations/` | NEW MIGRATION | Sessions, questions, notifications, policies, indexes |
| `backend/src/services/PoolManager.js` | MODIFY | Forward harness env, sandbox limits, model/provider mapping |
| `frontend/src/` | CREATE/MODIFY | Notification bell, question inbox/cards, agent timeline, project policy settings |
| `database` | NEW TABLES | `agent_sessions`, `agent_events`, `ticket_questions`, `notifications`, `agent_policies` |
| `config` | NEW ENV VARS | `HARNESS_MODE`, `HARNESS_*`, `OPENCODE_*`, budgets, sandbox limits |

---

## Known Unknowns

1. **OpenCode server/API stability across versions.** Pin the OpenCode version in the agent image and
   cover the adapter with contract-style tests against a pinned fake server.
2. **Question/form API shape in the deployed OpenCode version.** The v2 API exposes session forms and
   permission replies. Pin the version, extract the OpenAPI JSON linked from `/doc` (current versions
   expose `/v2/openapi.json`) into a checked-in fixture, and assert the exact paths the client uses.
   Do not rely on the deprecated `/session/:id/permissions/:permissionID` endpoint.
3. **Provider compatibility.** Not every OpenAI-compatible model handles long tool loops well. Start with
   a verified coding model and keep the model configurable per project.
4. **Toolchain coverage.** The agent image must include runtimes used by target repos. Start with Node 24,
   Python 3.12, git, ripgrep; add images/toolchains per project later.
5. **Cost runaway.** Long agent loops can be expensive. Budgets and pause-on-threshold are mandatory.

---

## Important Design Decisions

1. **Execution engine** — (A) OpenCode server harness (recommended), (B) custom native tool loop,
   (C) one-shot `opencode run` CLI. See 02 for trade-offs.
2. **Autonomy default** — `standard` (recommended) vs `autonomous` vs `supervised`.
3. **Human alerts MVP** — in-app only (recommended) vs email/Slack in the first iteration.
4. **Plan gate** — risk-based (recommended) vs always require human plan approval vs never.
5. **Publishing** — supervisor commits/pushes/opens PR (recommended) vs allowing the harness to run git
   push/commit itself.
6. **Isolation** — harden the existing agent container per ticket (recommended for Phase 1) vs nested
   per-ticket sandbox containers (stronger, more work).
7. **Default budgets** — 45 min, 1.5M tokens, $5/ticket, 100 tool calls (recommended; configurable).
8. **Feature rollout** — `HARNESS_MODE=legacy|opencode` with legacy fallback (recommended).
9. **Phase 1 permission model** — unattended, no `ask`: safe bash allowlist + deny list + auto-reject
   fallback (recommended). The alternative, a minimal permission bridge, is Phase 2 because it needs
   the question/notification loop.
10. **Credential isolation** — tokenless clone (no PAT in `.git/config`), supervisor-side push auth,
    localhost provider proxy holding the real key, workspace sanitizer and output redaction
    (recommended). Putting the key in a temporary config readable by the harness is rejected.

---

## Acceptance Criteria

### Harness core (Phase 1)

1. [ ] A backlog ticket can be processed end-to-end by the harness with no human intervention and **no permission prompt** (there are no `ask` rules, and any unexpected permission request is auto-rejected).
2. [ ] The harness reads repository files, searches code, edits/creates files, runs safe test/lint/typecheck commands and iterates.
3. [ ] A test failure causes the agent to inspect output and retry up to the configured limit.
4. [ ] The supervisor opens exactly one PR from `vibecode/ticket-<id>-<slug>` and never merges or pushes to main.
5. [ ] The ticket moves to `review` only after the configured verification commands pass; `status` and `phase` change atomically.
6. [ ] The clone and workspace contain no GitHub token; pushes authenticate in the supervisor only.
7. [ ] The harness cannot read the provider key, `.env*` or secret files; provider calls go through a localhost proxy.
8. [ ] All posted output, events and logs are redacted; a fake output containing a token is proven redacted.
9. [ ] Verification autodetection distinguishes Jest from Vitest (and falls back to explicit commands).
10. [ ] `HARNESS_MODE=legacy` still uses the existing processor; the new path is opt-in.
11. [ ] Deterministic tests use a fake harness server; CI does not call a real model.

### Human-in-the-loop (Phase 2)

12. [ ] When the agent asks a question, a `ticket_question` is created, the ticket enters `blocked`, and a notification is produced.
13. [ ] The human sees the question within one polling interval (≤10s) in the notification bell and ticket view.
14. [ ] Answering the question persists the answer, transitions the ticket to `in_progress`, and resumes the harness within one polling interval.
15. [ ] Heartbeats expose session id, current tool/step, elapsed time, tokens and cost; a ticket/session list endpoint lets the UI find the active session.
16. [ ] Event replay cannot create duplicate sessions or questions (idempotency keys are enforced by unique indexes).
17. [ ] Resume is explicit: a new session reads the answered question, the workspace diff and a prior-session summary; it never assumes the old process is alive.
18. [ ] Permission requests follow policy: safe operations auto-approved, dangerous denied, ambiguous asked (the bridge exists only in Phase 2; Phase 1 has no `ask`).
19. [ ] Questions expire after a configurable timeout and surface an escalation notification.
20. [ ] All questions/answers are auditable and scoped to the owning project/user.

### Autonomy and safety (Phase 3)

21. [ ] Policies enforce max duration, tokens, cost, tool calls, files changed and diff size.
22. [ ] Changes touching protected paths (auth, migrations, `.github/`, secrets) require human plan/action approval.
23. [ ] The agent cannot read `.env` files, access outside the workspace, push, merge, or run denied commands.
24. [ ] A risk-based plan gate exists and can be configured per project.
25. [ ] Multi-agent mode (architect → builder → reviewer) can be enabled per project without changing the ticket workflow.

### Cross-cutting

26. [ ] Backend unit + integration + bash suites pass; frontend unit/component/E2E/contract suites pass.
27. [ ] Coverage remains ≥60% on both layers.
28. [ ] OpenAPI spec and generated types are updated.
29. [ ] Documentation, env examples and Jenkins/CI are updated.
30. [ ] No secrets appear in logs, events or ticket messages.

---

## Out of Scope

- Auto-merge, auto-deploy, or production changes without a human.
- Email/Slack adapters (Phase 2 follow-up).
- A generic plugin marketplace for harnesses (design leaves an interface, not an implementation).
- Reworking the planner's planning documents or templates.
- Windows-native agent execution (agents run in Linux containers).

---

## Performance Considerations

- One OpenCode server per active ticket, started in the ticket workspace; ~1–3s startup.
- Agent container memory: 2GB minimum; harness + Node + tests may need 4GB. Make it configurable.
- Event streaming must not block the session; batch DB writes (e.g., every 500ms or 20 events).
- Event retention: 30 days with truncation; transcripts capped per session.
- Polling for human answers: 5s while blocked; exponential backoff after 10 minutes.

---

## Security Considerations

- [x] Authentication required: agent endpoints use `X-API-Key`; human endpoints use JWT.
- [x] Authorization: project-scoped; questions/notifications only visible to project members.
- [x] Input validation: Joi schemas for answers, policies, session events.
- [x] Rate limiting: question answers and notification polling.
- [x] Sensitive data: the provider key lives only in the supervisor's provider proxy; the harness gets a
  per-run dummy token. GitHub auth is held by the supervisor (tokenless clone + one-shot push header).
  Current `WorkspaceManager.cloneRepo()` embeds the PAT in the clone URL and persists it with
  `git remote set-url`; Phase 1 replaces that behavior rather than preserving it.
- [x] Workspace sanitisation: `.env*` (except `.env.example`), secret files and token-bearing
  `.git/config` entries are removed before the harness starts.
- [x] Redaction: messages, events, logs and errors pass through `SecretRedactor`; tested with fake
  output containing PAT/API-key shapes.
- [x] Sandbox: non-root, workspace-only, `external_directory: deny`, no Docker socket, resource limits.
- [x] Publishing: branch + PR only; no merge; protected paths (auth, migrations, workflows, secrets)
  block publishing in Phase 1 and require approval in Phase 3.
- [x] Phase 1 never uses `ask`: safe bash allowlist + deny list, and any unexpected permission request
  is auto-rejected rather than blocking the run.

---

## Testing Checklist

### Test-First Requirement

- [ ] Empty test stubs created before production code for Phase 1 files.
- [ ] Stubs filled with assertions after implementation.

### Backend Tests

- [ ] `backend/src/__tests__/agentSessions.test.js` — create/update session, list by ticket, ownership, auth, idempotent external session id.
- [ ] `backend/src/__tests__/questions.test.js` — ask/answer/expire, phase transitions, isolation, duplicate external id replay.
- [ ] `backend/src/__tests__/agentHeartbeat.test.js` — optional session/tool/token/cost fields and session-as-heartbeat source.
- [ ] `backend/src/__tests__/notifications.test.js` — create/list/read, unread count, isolation.
- [ ] `backend/src/__tests__/agentPolicies.test.js` — CRUD, defaults, validation.
- [ ] `backend/src/__tests__/integration/agentHarness.test.js` — full ask→answer→resume flow.
- [ ] `backend/integration-test/suites/harness.test.sh` — curl flow for questions/notifications.

### Agent Tests (Java)

- [ ] `OpenCodeClientTest` — health, session create, async prompt, subscribe-before-prompt timing,
  event parsing, permission reply and auto-reject fallback.
- [ ] `EventMapperTest` — tool events → heartbeat/messages/usage.
- [ ] `PermissionPolicyTest` — Phase 1 allow/deny matrix, safe bash allowlist, no `ask` values,
  protected paths, auto-reject.
- [ ] `PromptBuilderTest` — includes ticket, planning docs, AGENTS.md, definition of done.
- [ ] `HarnessSessionTest` — fake server produces question → maps to ticket question, resume after answer.
- [ ] `WorkspaceDiffTest` — collects diff, rejects protected paths, tokenless clone/push metadata.
- [ ] `SecretRedactorTest` — PAT/API-key/bearer shapes removed from messages, events and errors.
- [ ] `ProviderProxyTest` — real key never leaves the proxy; harness dummy token works; session header forwarded.
- [ ] `WorkspaceSanitizerTest` — `.env*`, secrets and `.git/config` credentials removed before start.
- [ ] `TicketLifecycleSyncTest` (backend) — pickup/release/review/block update status and phase atomically.

### Frontend Tests

- [ ] `notificationBell.test.ts` — unread count, list, mark read, navigation.
- [ ] `agentQuestion.test.ts` — renders options, submits answer, handles timeout.
- [ ] `ticketAgentTab.test.ts` — timeline, session status, question card.
- [ ] `agentPolicySettings.test.ts` — loads/saves policy.
- [ ] Cypress component for question card and notification bell.
- [ ] Cypress E2E: agent asks → human answers → ticket resumes.

### CI Requirements

- [ ] Backend unit/coverage/integration/bash suites.
- [ ] Agent `mvn test`.
- [ ] Frontend unit/coverage/typecheck/build.
- [ ] Contract test and generated types.
- [ ] A deterministic harness E2E using the fake server (no live model).

---

## Anti-Patterns to Avoid

- ❌ Sending only a file list to the model — the core defect this ticket fixes.
- ❌ Letting the model return whole-file JSON for modifications (destroys unread code).
- ❌ Letting the agent push/merge directly; publishing belongs to the supervisor.
- ❌ Storing provider keys, GitHub tokens or `.env` contents in event logs.
- ❌ Using `ask` permissions in an unattended Phase 1 run (it deadlocks without a bridge).
- ❌ Persisting a PAT in `.git/config`, or putting the real provider key anywhere the harness can read.
- ❌ Blocking a poll loop while waiting for a human; use a parked session + polling.
- ❌ Auto-approving dangerous commands because the model asked nicely.
- ❌ Creating a second approval system; extend phases/questions/approvals instead.
- ❌ Running a real model in CI; deterministic fake harness only.
- ❌ One giant ticket; implement in phases with functioning checkpoints.
