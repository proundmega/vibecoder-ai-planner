# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-07-12
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend | Java Agent | Both

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input

### Existing Infrastructure Audit

- [ ] I have checked `AgentConfig.java` — reads AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_ENDPOINT_URL from env vars
- [ ] I have checked `AgentApp.java` — `createAiProvider()` builds provider from env vars at startup
- [ ] I have checked `ApiService.java` — has `getDecryptedKey()` method but it's **never called** (dead code)
- [ ] I have checked `TicketProcessor.java` — uses `aiProvider` instance for AI calls
- [ ] I have checked backend `agents` table — now has `provider_id` column (from bp-01)
- [ ] I have checked backend `providers` table — global providers with encrypted API keys
- [ ] I have checked `AgentService.getAgentByApiKey()` — returns agent including provider_id
- [ ] I have checked Java agent docker-compose.yml — env vars for AI config
- [ ] I have checked `AgentService.create()` — now accepts `providerId` (from bp-01)

### Database & Migration

- [ ] No new DB migrations needed — uses existing `providers` table from bp-01
- [ ] `agents.provider_id`FK already exists from bp-01
- [ ] New API endpoint needed: `GET /api/v1/agents/:agentId/provider-config` — returns decrypted provider config

### Testing Strategy

- [ ] Backend: Test new `/agents/:agentId/provider-config` endpoint
- [ ] Backend: Test that provider config includes correct decrypted API key
- [ ] Java agent: Test provider config fetch at startup
- [ ] Java agent: Test that provider is created with config from backend (not env vars)
- [ ] Java agent: Test fallback to env vars if backend fetch fails
- [ ] No existing Java tests — need to create test infrastructure

### Configuration Audit

- [ ] No new environment variables needed
- [ ] Existing env vars (AI_PROVIDER, AI_MODEL, etc.) become optional — backed by backend
- [ ] Backward compatibility: env vars still work as fallback if backend fetch fails

---

## Post-Implementation Checklist

- [ ] Backend: `npm test` passes
- [ ] Backend: `npm run lint` passes
- [ ] Java agent: compiles with `mvn clean package`
- [ ] Java agent: docker image builds successfully
- [ ] Agent can start with only AGENT_API_KEY + BACKEND_URL (no AI_* env vars)
- [ ] Agent fetches provider config from backend and uses it
- [ ] Agent falls back to env vars if backend fetch fails
- [ ] Docker-compose agent service works with minimal env vars

---

## When to Ask the User

1. **Java testing strategy** — No existing Java tests. Should we add JUnit 5 tests, or keep it simple with manual testing?
2. **Fallback behavior** — If backend fetch fails, should the agent crash (fail-fast) or fall back to env vars?

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
