# bp-50: Add Missing Unit Tests for TemplateService, ProviderService, AgentService

**Status**: planned
**Date created**: 2026-06-30
**Scope**: Testing / Backend
**Priority**: P2
**Effort**: Medium

## Requirement

Three more backend services are missing direct unit tests. TemplateService is the largest untested file in the codebase (630 lines) — its controller test fully mocks the service, exercising zero service logic. ProviderService has a rules engine for label/priority-based AI provider routing. AgentService has rate limiting with daily quota calculation.

## Existing Infrastructure Audit

### Feature 1: TemplateService (bp-31 — Custom Templates)
- File: `backend/src/services/TemplateService.js` (630 lines)
- Controller test exists at `src/__tests__/templateController.test.js` but **completely mocks** TemplateService via `jest.mock`
- Tested methods: none — `list()`, `create()`, `apply()`, `delete()`, `getArchitectTemplateContent()`, `getTechnicalTemplateContent()`, `getSimpleTemplateContent()`, `getSpecificationTemplateContent()` all untested
- Referenced in: `templateController.test.js` (mocked), `ticketPlanning.test.js`, `routeOrdering.test.js`

### Feature 2: ProviderService (bp-29 / bp-41 — Provider Config & Model Routing)
- File: `backend/src/services/ProviderService.js` (95 lines)
- Complex logic: `resolveProvider()` with label/priority matching, `_matches()` with multi-condition boolean logic, `_buildProviderConfig()` with API key decryption
- No test coverage at all

### Feature 3: AgentService — Agent Management
- File: `backend/src/services/AgentService.js` (121 lines)
- Complex logic: `getAgentDailyLimit()` with LEFT JOIN + DATE() aggregate, `getAgentTickets()` with nested subquery, `getAgentByApiKey()` for API key auth
- No test coverage at all

## Acceptance Criteria

- [ ] `backend/src/__tests__/templateService.test.js` exists covering: `list()`, `create()`, `apply()` (transaction + rollback), `delete()` (ownership guard), and template content generators return correct string for valid/invalid keys
- [ ] `backend/src/__tests__/providerService.test.js` exists covering: `getProjectProvider()`, `resolveProvider()` with label matching, priority matching, fallback, no-rules default, `_matches()` edge cases, `_buildProviderConfig()` API key resolution
- [ ] `backend/src/__tests__/agentService.test.js` exists covering: `create()`, `getAgentDailyLimit()` (rate/used/available), `getAgentByApiKey()`, `getAgentTickets()`, `registerAction()`, `incrementDailyUsage()`
- [ ] All new tests pass: `cd backend && npm test`
- [ ] Existing tests still pass (especially templateController.test.js which mocks TemplateService)

## Out of Scope

- Template controller tests (already exist, no change needed)
- Frontend template tests (already exist in `frontend/src/__tests__/templates.test.js`)
- Integration tests for these services
- Refactoring the services themselves
