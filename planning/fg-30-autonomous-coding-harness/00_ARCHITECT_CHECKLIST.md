# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-10-31
**Date completed**: —
**Author**: AI Assistant
**Feature scope**: Both (Agent + Backend + Frontend + Infrastructure)

---

## Pre-Implementation Checklist

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — requirement, scope, acceptance criteria understood
- [x] I have read `02_ARCHITECT_DESIGN.md` — design, alternatives, risks understood
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — phases, actions, testing understood
- [x] I have read `04_SPECIFICATION.md` — Phase 1 file operations and signatures understood
- [x] Assumptions identified and documented in `01` ("Known Unknowns")
- [x] IN scope / OUT of scope documented
- [x] Design decisions requiring user input listed in `01` ("Important Design Decisions")
- [x] Pending scope items from previous tickets listed and presented (PR #101 comment, 10 items)

### Existing Infrastructure Audit

- [x] Backend API checked: tickets, phases, messages, approvals, agents, providers, heartbeats exist
- [x] Frontend API clients checked (`frontend/src/api/`) — no questions/notifications/sessions clients yet
- [x] Frontend UI checked — `TicketDetail.vue`, `PhaseBlocked.vue`, `App.vue` are the extension points
- [x] Router checked — no question/notification routes yet
- [x] Existing patterns identified — controller/service/validator/Joi, `client.ts` fetch wrapper
- [x] Existing tabs/sections identified — TicketDetail sections, PhaseFlow/PhaseBlocked
- [x] Feature extends existing code rather than creating parallel systems
- [x] Shared components identified — VModal/VInput/VButton patterns exist in this project

### Both Frontend AND Backend

- [x] Backend route/controller/service plan exists for sessions/questions/notifications/policies
- [x] Frontend UI placement identified (TicketDetail, PhaseBlocked, global bell, question inbox)
- [x] Integration plan documented (API clients → stores → components)
- [x] OpenAPI JSDoc annotations planned for new routes
- [x] Generated TypeScript types regeneration planned
- [x] Response validation (`validator.ts`) and contract test updates planned

### Dependency Analysis

- [x] New agent dependency: pinned `opencode-ai` server + Node 24 in agent image
- [x] New Java dependency: `okhttp-sse` (SSE) and `mockwebserver` (tests)
- [x] Existing services affected: AgentApp, AgentConfig, WorkspaceManager, GitHubService, PoolManager
- [x] Breaking changes: none required; feature flag `HARNESS_MODE` preserves legacy
- [x] No circular dependencies planned; `HarnessClient` isolates the engine

### Configuration Audit

- [x] New env vars listed in `01/03/04` and to be added to `.env.example`/AGENTS.md
- [x] Config files: temporary OpenCode config generated outside the repo; no committed secrets
- [x] Backward compatibility: `HARNESS_MODE=legacy` default in Phase 1

### Database & Migration

- [x] Migration plan for Phase 2: `agent_sessions`, `agent_events`, `ticket_questions`,
      `notifications`, `agent_policies`, `ticket_messages.agent_session_id`
- [x] Migration added to `apply.js` in correct array order (planned)
- [x] Rollback file planned
- [x] No destructive changes to existing tables

### Testing Strategy

- [x] Java unit/contract tests identified (fake OpenCode server, no live model)
- [x] Backend Jest tests identified (questions/sessions/notifications/policies)
- [x] Jest integration scenarios identified (ask→answer→resume, phase transitions)
- [x] Bash integration suite tests planned (`harness.test.sh`)
- [x] Frontend Vitest/Cypress tests planned (bell, question card, ticket tab, policy)
- [x] Contract/validator updates planned
- [x] Test stubs to be created before production code (Phase 1/2)
- [x] Coverage thresholds (60%) included in acceptance
- [x] No real AI calls in CI

### Implementation Readiness

- [x] Phased plan with checkpoints (Phase 1 harness, Phase 2 human loop, Phase 3 autonomy, Phase 4 hardening)
- [x] Files to create vs modify listed in `03`
- [x] Existing patterns to follow documented
- [x] Testing approach documented
- [x] Branch identified: `feature/fg-30-autonomous-coding-harness`
- [x] Provider key validated (Go key works with `x-opencode-session`; verified 2026-10-31)
- [x] GitHub PAT validated (push + admin on `proundmega/gtd`; verified 2026-10-31)
- [x] Phase 1 permission model is genuinely unattended: no `ask` rules, safe bash allowlist, deny list, auto-reject fallback (see `04`)
- [x] Credential isolation designed: tokenless clone, provider proxy, workspace sanitizer, output redaction (see `02`/`04`)
- [x] Phase 1 vs Phase 0 scope reconciled; backend lifecycle sync is explicit (see `03`/`04`)
- [x] Session list, heartbeat metadata, phase/status sync and idempotency have concrete designs (see `02`)

---

## Post-Implementation Checklist

- [ ] Agent unit/contract tests pass (`mvn test`)
- [ ] Backend unit tests pass (`npm test`)
- [ ] Backend coverage passes (`npm run test:coverage`)
- [ ] Backend integration tests pass (`npm run test:integration`)
- [ ] Bash integration suite passes (`bash backend/integration-test/run.sh --only`)
- [ ] Frontend lint/typecheck/tests/coverage/build pass
- [ ] Feature flag legacy path verified
- [ ] Harness path verified on a scratch ticket (PR opened, no merge)
- [ ] Phase 1 unattended run completes with no permission prompt (safe bash only; denied commands blocked)
- [ ] Tokenless clone verified: no PAT in `.git/config`, workspace, logs or messages
- [ ] Provider key never readable by the harness (proxy-only) and output redaction verified
- [ ] Phase/status stay synchronised on pickup, release, failure, block and review
- [ ] Human question → notification → answer → resume verified (Phase 2)
- [ ] Protected paths and denied commands block publishing
- [ ] No secrets in logs/events/messages
- [ ] OpenAPI spec and generated types regenerated
- [ ] `AGENTS.md`, README, `.env.example` updated
- [ ] `03` updated with dates/PR/branch
- [ ] `04` reflects final implementation

## When to Ask the User

Stop and ask the user if:

1. Acceptance criteria are ambiguous (e.g., which files an agent may touch).
2. A provider/model cannot complete a tool loop reliably after two retries.
3. OpenCode's API shape differs from the pinned specification in a breaking way.
4. Sandboxing requires a privileged capability or host access.
5. Budget/cost defaults are exceeded during a live ticket.
6. A migration or secret-handling change could affect running users.
7. The scope grows beyond the four phases in `03`.

---

*This checklist confirms the plan is ready for approval. Implementation does not start until the user
confirms the design decisions in `01`. *
