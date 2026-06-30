# bp-50: Add Missing Unit Tests for TemplateService, ProviderService, AgentService — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Scope**: Testing / Backend
**Branch**: feat/bp-50-more-unit-tests

## Purpose
Add Jest unit tests for 2 more backend services and 1 massive service that currently has mock-only coverage.

## Implementation Order

1. **ProviderService** (smallest, no new deps to mock)
2. **AgentService** (medium, mostly CRUD + one complex query)
3. **TemplateService** (largest — content generators first, then DB operations)
4. **Run full suite** — `cd backend && npm test`

## Per-File Action Plan

### 1. `backend/src/__tests__/providerService.test.js` (CREATE)

```javascript
jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn((key) => `decrypted-${key}`),
}));

const ProviderService = require('services/ProviderService');

describe('ProviderService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('getProjectProvider', () => {
    it('returns active provider config for project');
    it('returns null if no active config');
  });

  describe('resolveProvider', () => {
    it('returns default provider when no config exists');
    it('returns default provider when no routing rules defined');
    it('returns default provider when rules empty and no fallback');
    it('matches a rule by ticket label (OR logic)');
    it('matches a rule by priority');
    it('matches a rule by label AND priority');
    it('skips rule when label does not match');
    it('skips rule when priority does not match');
    it('uses fallback rule when no rule matches');
    it('sets is_fallback=true on fallback provider');
  });

  describe('_matches', () => {
    it('returns true for null match');
    it('returns true for undefined match');
    it('returns true for empty labels when no label filter');
    it('returns false when required label absent');
    it('returns false when priority mismatches');
    it('returns true when label matches but priority unspecified');
  });

  describe('_buildProviderConfig', () => {
    it('uses rule-level api_key when present');
    it('falls back to decrypted base api_key when no rule key');
    it('passes through provider, endpoint, model with rule overrides');
    it('uses default max_tokens and temperature when not specified');
  });
});
```

### 2. `backend/src/__tests__/agentService.test.js` (CREATE)

```javascript
const AgentService = require('services/AgentService');

describe('AgentService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('create', () => {
    it('inserts agent with default rate_limit and max_actions_per_day');
  });

  describe('list', () => {
    it('returns agents for user ordered by created_at DESC');
  });

  describe('getApiKey', () => {
    it('returns api_key for agent');
    it('returns null when agent not found');
  });

  describe('revokeApiKey', () => {
    it('sets api_key to NULL');
  });

  describe('getAgentDailyLimit', () => {
    it('returns used/available/limit with LEFT JOIN aggregate');
    it('returns zero used when no actions today');
    it('calculates available = max_actions_per_day - actions_today');
  });

  describe('getAgentByApiKey', () => {
    it('finds agent by exact api_key');
    it('returns undefined when no match');
  });

  describe('getAgentTickets', () => {
    it('returns tickets with nested subquery join');
  });

  describe('registerAction', () => {
    it('inserts action with cost_incurred = 0.05');
  });

  describe('incrementDailyUsage', () => {
    it('increments current_daily_usage by 1');
  });

  describe('delete', () => {
    it('deletes agent by id');
  });
});
```

### 3. `backend/src/__tests__/templateService.test.js` (CREATE)

Template content generators (pure functions, ~300 lines of template markdown):

```javascript
const TemplateService = require('services/TemplateService');

describe('TemplateService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('getArchitectTemplate', () => {
    it('returns 5 required template file definitions');
  });

  describe('getArchitectTemplateContent', () => {
    it('returns non-empty string for each known key');
    it('renders today date in dynamic fields');
    it('contains checklist title for 00_ARCHITECT_CHECKLIST.md');
    it('contains requirement title for 01_ARCHITECT_REQUIREMENT.md');
    it('contains design title for 02_ARCHITECT_DESIGN.md');
    it('contains implementation title for 03_ARCHITECT_IMPLEMENTATION.md');
    it('contains specification title for 04_SPECIFICATION.md');
    it('returns empty string for unknown key (fallback guard)');
  });

  describe('getTechnicalTemplate', () => {
    it('returns 3 required template file definitions');
  });

  describe('getTechnicalTemplateContent', () => {
    it('returns content for each known key');
    it('returns empty string for unknown key');
  });

  describe('getSimpleTemplate', () => {
    it('returns 1 required template file definition');
  });

  describe('getSimpleTemplateContent', () => {
    it('returns content for known key');
    it('returns empty string for unknown key');
  });

  describe('getSpecificationTemplate', () => {
    it('returns 1 required template file definition');
  });

  describe('getSpecificationTemplateContent', () => {
    it('returns content for known key');
    it('returns empty string for unknown key');
  });
```

DB operations:

```javascript
  describe('list', () => {
    it('returns templates with LEFT JOIN on creator name');
  });

  describe('create', () => {
    it('inserts template with JSON.stringify file_definitions');
    it('inserts template with null description when omitted');
  });

  describe('apply', () => {
    it('throws NotFoundError for missing template');
    it('inserts file_definitions into ticket_planning in a transaction');
    it('updates ticket planning_status and template_schema');
    it('rolls back on DB error');
  });

  describe('delete', () => {
    it('deletes template owned by user');
    it('returns undefined when template not owned by user');
  });
});
```

## Verification

1. `cd backend && npm test` — 3 new test files pass, existing tests unaffected
2. `npm run lint` — no errors
3. Autodetected by `**/__tests__/*.test.js` glob
