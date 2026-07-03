# 01_ARCHITECT_REQUIREMENT.md — Agent Orchestration & Ticket Ownership

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Only one agent can work on a ticket at a time. Ticket ownership prevents conflicts — when an agent (user) owns a ticket, no other agent can modify it. Agents coordinate via shared messages. Ticket status + ownership is the conflict prevention mechanism.

---

## Scope

- Ticket ownership field (agent_id)
- Status-based locking (in_progress → owned by one agent)
- Shared message board per ticket for agent coordination
- Agent-as-user pattern (agents are special user type)

---

## Testing Checklist (MANDATORY)

- [ ] **Happy path**: Agent A picks up ticket → creates branch → codes → finishes
- [ ] **Ownership lock**: Agent B cannot modify ticket while Agent A owns it
- [ ] **Status transition**: Moving ticket to 'review' releases ownership
- [ ] **Shared messages**: Agent A posts message → Agent B sees it
- [ ] **Edge cases**: Agent crashes (orphaned ownership), status reset, manual release

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors
- Backend integration test: ownership lock, message persistence

---

## Anti-Patterns to Avoid

- ❌ Testing implementation details — test behavior (ownership enforced)
- ❌ Tests that depend on execution order — each test independent
- ❌ Merging code without tests

---

## Code Change Requirements

1. Write unit tests before or alongside the implementation
2. Write integration tests covering the full request lifecycle
3. Run `npm test` — must pass
4. Pass `npm run lint` with zero errors
