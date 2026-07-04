# bp-50: Add Missing Unit Tests for TemplateService, ProviderService, AgentService — Design

**Status**: planned
**Date created**: 2026-06-30
**Scope**: Testing

## Current State

Three services with substantial untested logic:

| Service | Lines | Existing "coverage" | Actual exercised coverage |
|---------|-------|---------------------|--------------------------|
| TemplateService | 630 | templateController.test.js (mocked) | **Zero** — every method is jest.mock'd |
| ProviderService | 95 | providerController.test.js tests provider routes but uses ProviderRouter, not ProviderService | **Zero** |
| AgentService | 121 | None | **Zero** |

## Proposed Test Strategy

### TemplateService (630 lines)

Test structure — two logical groups:

**Group A: Template Content Generators** (300+ lines, pure functions)
- `getArchitectTemplateContent(fileKey)` / `getTechnicalTemplateContent(fileKey)` / `getSimpleTemplateContent(fileKey)` / `getSpecificationTemplateContent(fileKey)`
- Test: each known key returns a non-empty string containing the expected title/section
- Test: unknown key returns `''` (the `templates[fileKey] || ''` fallback)
- Test: dynamic content like `${new Date().toISOString().split('T')[0]}` renders today's date (not a template literal remnant)

**Group B: DB Operations**
- `list(projectId, userId)` — verify SQL params, LEFT JOIN result handling
- `create(projectId, name, description, fileDefinitions, userId)` — verify INSERT with JSON.stringify for file_definitions, optional description handling
- `apply(ticketId, templateId, userId)` — the complex one:
  - NotFoundError for missing template
  - BEGIN/COMMIT transaction with looped INSERTs into ticket_planning
  - UPDATE tickets with planning_status='template_selected' and template_schema
  - ROLLBACK on error
- `delete(templateId, userId)` — verify DELETE with created_by ownership guard, returning deleted row

### ProviderService (95 lines)

Test `resolveProvider()` and `_matches()` — the rules engine:

- **Label matching**: when rules specify labels like ["security", "bug"], `_matches` returns true if ticket has at least one matching label (OR logic)
- **Priority matching**: when rule specifies "high", matches only "high" tickets
- **Combined conditions**: label AND priority must match
- **No match**: returns false when no labels match OR priority differs
- **Null/undefined match**: `_matches(null, ...)` returns true (no filter = match all)

Also test:
- **No rules**: `resolveProvider` → `_defaultProvider` path
- **Rules with no match + no fallback**: → `_defaultProvider` path
- **Rules with no match + with fallback**: → `_buildProviderConfig` with `isFallback: true`
- **API key resolution**: `_buildProviderConfig` uses rule-level api_key when present, falls back to decrypt(baseConfig.api_key_encrypted)

### AgentService (121 lines)

Test:

- **CRUD**: `create`, `list`, `delete` — verify SQL params
- **Rate limiting**: `getAgentDailyLimit` — verify LEFT JOIN, COALESCE for actions_today, correct available calculation
- **Auth**: `getAgentByApiKey` — verify exact WHERE clause
- **Complex query**: `getAgentTickets` — verify nested subquery returns joined ticket records
- **Usage**: `registerAction` with cost_incurred constant, `incrementDailyUsage` with `+ 1` update

## Key Testing Patterns

### PG mock already available
All services use `require('../db').pool` or `require('pg')` — the global jest mock in `jest.setup.js` already provides `pool.query.mockResolvedValue({ rows: [] })`.

### Crypto mock for ProviderService
`ProviderService` depends on `require('../utils/crypto')` for `decrypt()`. Need to mock:
```javascript
jest.mock('../utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn((k) => `decrypted-${k}`) }));
```

### TemplateService static structure
TemplateService is a class with only static methods. Tests instantiate nothing — just call `TemplateService.methodName()`.
