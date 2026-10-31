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
| 1 | bp-120 | Agent connectivity fixes (double-wrapped provider config, heartbeat listing, Java defensive parsing) — prerequisite for reliable harness provider config | Agent | `bp-120-agent-connectivity-fixes` | ☐ |
| 2 | bp-121 | Agent IP/CORS/whitelist support for non-localhost agents — needed for remote harness nodes | Agent / Security | `bp-121-agent-connectivity-ip` | ☐ |
| 3 | bp-71 | Email notification on account lockout — reuse the notification channel for agent questions | Security / UX | `bp-71-email-notifications` | ☐ |
| 4 | bp-74 | API key rotation/expiry — extend to harness session credentials | Security | `bp-74-session-credentials` | ☐ |
| 5 | bp-14 | S3 storage for planning artifacts — harness needs planning docs from a stable store | Infrastructure | `bp-14-s3-planning-storage` | ☐ |
| 6 | bp-53 | Distributed state/cache — active harness sessions across replicas | Infrastructure | `bp-53-harness-session-state` | ☐ |
| 7 | bp-106 | Log aggregation — ship harness event streams to the aggregation pipeline | Observability | `bp-106-harness-event-shipping` | ☐ |
| 8 | bp-04 | Usage/billing — per-ticket budget alerts and real-time cost dashboard for harness runs | Observability / Billing | `bp-04-harness-budgets` | ☐ |
| 9 | fg-13 | FE↔BE contract inconsistencies — new question/notification/session APIs must update `validator.ts` and the contract test | Testing | `fg-13-contract-followup` | ☐ |
| 10 | bp-99 | Cypress E2E suite is stale and not in Jenkins — new question/notification flows need E2E coverage | Testing | `bp-99-e2e-harness-ui` | ☐ |

**All items above must be presented to the user before ticket approval.** They are presented in the
response accompanying this plan.

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
   permission replies; verify against the pinned OpenAPI spec at `http://<server>/doc` during implementation.
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

---

## Acceptance Criteria

### Harness core (Phase 1)

1. [ ] A backlog ticket can be processed end-to-end by the harness with no human intervention.
2. [ ] The harness reads repository files, searches code, edits/creates files, runs tests/lint/typecheck and iterates.
3. [ ] A test failure causes the agent to inspect output and retry up to the configured limit.
4. [ ] The supervisor opens exactly one PR from `vibecode/ticket-<id>-<slug>` and never merges or pushes to main.
5. [ ] The ticket moves to `review` only after the configured verification commands pass (or a human overrides).
6. [ ] Heartbeats expose session id, current tool/step, elapsed time, tokens and cost.
7. [ ] `HARNESS_MODE=legacy` still uses the existing processor; the new path is opt-in.
8. [ ] Deterministic tests use a fake harness server; CI does not call a real model.

### Human-in-the-loop (Phase 2)

9. [ ] When the agent asks a question, a `ticket_question` is created, the ticket enters `blocked`, and a notification is produced.
10. [ ] The human sees the question within one polling interval (≤10s) in the notification bell and ticket view.
11. [ ] Answering the question persists the answer, transitions the ticket to `in_progress`, and resumes the harness within one polling interval.
12. [ ] Permission requests follow policy: safe operations auto-approved, dangerous denied, ambiguous asked.
13. [ ] Questions expire after a configurable timeout and surface an escalation notification.
14. [ ] All questions/answers are auditable and scoped to the owning project/user.

### Autonomy and safety (Phase 3)

15. [ ] Policies enforce max duration, tokens, cost, tool calls, files changed and diff size.
16. [ ] Changes touching protected paths (auth, migrations, `.github/`, secrets) require human plan/action approval.
17. [ ] The agent cannot read `.env` files, access outside the workspace, push, merge, or run denied commands.
18. [ ] A risk-based plan gate exists and can be configured per project.
19. [ ] Multi-agent mode (architect → builder → reviewer) can be enabled per project without changing the ticket workflow.

### Cross-cutting

20. [ ] Backend unit + integration + bash suites pass; frontend unit/component/E2E/contract suites pass.
21. [ ] Coverage remains ≥60% on both layers.
22. [ ] OpenAPI spec and generated types are updated.
23. [ ] Documentation, env examples and Jenkins/CI are updated.
24. [ ] No secrets appear in logs, events or ticket messages.

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
- [x] Sensitive data: provider keys and GitHub tokens never logged or stored in events; `.env` denied.
- [x] Sandbox: non-root, workspace-only, network allowlist, no Docker socket, resource limits.
- [x] Publishing: branch + PR only; no merge; protected paths gated.

---

## Testing Checklist

### Test-First Requirement

- [ ] Empty test stubs created before production code for Phase 1 files.
- [ ] Stubs filled with assertions after implementation.

### Backend Tests

- [ ] `backend/src/__tests__/agentSessions.test.js` — create/update session, ownership, auth.
- [ ] `backend/src/__tests__/questions.test.js` — ask/answer/expire, phase transitions, isolation.
- [ ] `backend/src/__tests__/notifications.test.js` — create/list/read, unread count, isolation.
- [ ] `backend/src/__tests__/agentPolicies.test.js` — CRUD, defaults, validation.
- [ ] `backend/src/__tests__/integration/agentHarness.test.js` — full ask→answer→resume flow.
- [ ] `backend/integration-test/suites/harness.test.sh` — curl flow for questions/notifications.

### Agent Tests (Java)

- [ ] `OpenCodeClientTest` — health, session create, prompt, event parsing, permission reply.
- [ ] `EventMapperTest` — tool events → heartbeat/messages/usage.
- [ ] `PermissionPolicyTest` — allow/ask/deny matrix, protected paths, commands.
- [ ] `PromptBuilderTest` — includes ticket, planning docs, AGENTS.md, definition of done.
- [ ] `HarnessSessionTest` — fake server produces question → maps to ticket question, resume after answer.
- [ ] `WorkspaceDiffTest` — collects diff, rejects protected paths, commit/push metadata.

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
- ❌ Blocking a poll loop while waiting for a human; use a parked session + polling.
- ❌ Auto-approving dangerous commands because the model asked nicely.
- ❌ Creating a second approval system; extend phases/questions/approvals instead.
- ❌ Running a real model in CI; deterministic fake harness only.
- ❌ One giant ticket; implement in phases with functioning checkpoints.
