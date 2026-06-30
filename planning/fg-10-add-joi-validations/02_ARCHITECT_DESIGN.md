# 02_ARCHITECT_DESIGN.md — Add Joi Input Validation to Missing Routes

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Backend mutation routes were created without input validation middleware. While the project has Joi validation infrastructure and patterns, these new routes bypass it, accepting raw request bodies without schema enforcement.

---

## Current State

### Existing Backend
- `backend/src/middleware/validate.js` — validate middleware exists and works
- `backend/src/validators/providers.js` — existing schemas for provider credential CRUD
- `backend/src/validators/tickets.js` — existing schemas for ticket operations

### Gap Analysis
- Provider config routes (PR 7, 13) use `provider/:projectId/provider` path prefix but have no schemas
- Pool routes (PR 8) have no schemas
- Compute node routes (PR 12) have no schemas

---

## Design

### Option A: Create separate validator files per domain (Recommended)

Create new validator files for each domain consistent with the project pattern:
- `backend/src/validators/pool.js`
- `backend/src/validators/computeNodes.js`
- `backend/src/validators/providerConfig.js`

Apply via existing `validate(schema)` middleware on each route.

### Option B: Add schemas to existing validator files
- Provider config schemas could go in `providers.js` (but those are for credential CRUD, not config)
- Pool and compute node schemas don't fit in any existing file
- **Decision**: Create separate files following the project's one-validator-per-domain pattern

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/validators/pool.js` | CREATE | `requestAgentSchema`, `releaseAgentSchema` |
| `backend/src/validators/computeNodes.js` | CREATE | `createNodeSchema`, `updateNodeSchema` |
| `backend/src/validators/providerConfig.js` | CREATE | `setProviderConfigSchema`, `testProviderConnectionSchema` |
| `backend/src/api/providers.js` | MODIFY | Import schemas, add `validate()` middleware to 3 routes |
| `backend/src/api/pool.js` | MODIFY | Import schemas, add `validate()` middleware to POST routes |
| `backend/src/api/compute-nodes.js` | MODIFY | Import schemas, add `validate()` middleware to POST/PUT routes |

---

## Validation Schemas

### pool.js
```javascript
const Joi = require('joi');

const requestAgentSchema = Joi.object({
  project_id: Joi.string().uuid().required(),
  repo_url: Joi.string().uri().optional(),
  provider_config: Joi.object({
    endpoint: Joi.string().uri().optional(),
    apiKey: Joi.string().optional(),
    model: Joi.string().optional(),
  }).optional(),
});

const releaseAgentSchema = Joi.object({
  agent_id: Joi.string().required(),
});
```

### computeNodes.js
```javascript
const createNodeSchema = Joi.object({
  name: Joi.string().min(1).max(128).required(),
  host: Joi.string().hostname().required(),
  port: Joi.number().port().required(),
  username: Joi.string().required(),
  ssh_key: Joi.string().optional(),
  max_agents: Joi.number().integer().min(1).max(100).default(4),
  tags: Joi.array().items(Joi.string()).optional(),
});
```

### providerConfig.js
```javascript
const setProviderConfigSchema = Joi.object({
  provider: Joi.string().valid('openai', 'claude', 'ollama', 'vllm', 'llamacpp', 'custom').required(),
  endpoint_url: Joi.string().uri().allow('').optional(),
  model: Joi.string().required(),
  api_key_credential_id: Joi.string().uuid().optional(),
  fallback_provider: Joi.string().optional(),
});

const testProviderConnectionSchema = Joi.object({
  endpoint_url: Joi.string().uri().required(),
  model: Joi.string().optional(),
  api_key: Joi.string().optional(),
});
```
