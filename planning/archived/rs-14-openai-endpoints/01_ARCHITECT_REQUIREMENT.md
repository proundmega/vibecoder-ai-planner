# 01_ARCHITECT_REQUIREMENT.md — OpenAI-Compatible Endpoint Support

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Support OpenAI-compatible API endpoints (not just Anthropic). Projects can configure multiple providers (e.g., Claude for planning, OpenAI for coding, local models for testing). Each provider gets a mini role (planner/worker/reviewer/approver). Providers stored per-project, rarely change.

---

## Scope

- OpenAI-compatible endpoints (OpenAI, LM Studio, vLLM, Ollama, Together.ai, etc.)
- Per-project provider configuration
- Multiple providers per project with role assignment
- Provider-specific folder structure for easy extension
- Role-based provider selection (planner uses Claude, worker uses OpenAI)

---

## Testing Checklist (MANDATORY)

- [ ] **Happy path**: Project creates provider config → agent uses correct provider
- [ ] **Multi-provider**: Project uses 2+ providers with different roles
- [ ] **Generic endpoint**: Non-OpenAI endpoint works (custom base URL)
- [ ] **Error handling**: Provider API failures, invalid keys, rate limits
- [ ] **Edge cases**: Empty provider list, all providers down, key rotation
- [ ] **Authorization**: Only project_admin can manage providers

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors
- Backend integration test: mock provider API, verify request/response

---

## Anti-Patterns to Avoid

- ❌ Hardcoding provider-specific logic — use interface pattern
- ❌ Storing keys in plaintext — encrypt in DB
- ❌ Testing implementation details — test behavior (correct provider called)
- ❌ Merging code without tests

---

## Code Change Requirements

1. Write unit tests before or alongside the implementation
2. Write integration tests covering the full request lifecycle
3. Run `npm test` — must pass
4. Pass `npm run lint` with zero errors
