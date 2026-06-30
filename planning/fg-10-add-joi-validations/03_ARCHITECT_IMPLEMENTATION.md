# 03_ARCHITECT_IMPLEMENTATION.md — Add Joi Input Validation to Missing Routes

---

## Ticket: fg-10 — Add Joi input validation to missing routes

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-29
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Add Joi validation schemas and middleware to backend mutation routes that currently accept raw request body without validation.

---

### b) Actions

#### Implementation Order

1. **Create validator files** — `backend/src/validators/`
   - Create `pool.js` with requestAgentSchema and releaseAgentSchema
   - Create `computeNodes.js` with createNodeSchema and updateNodeSchema
   - Create `providerConfig.js` with setProviderConfigSchema and testProviderConnectionSchema
   - *Depends on*: nothing

2. **Update route files** — `backend/src/api/`
   - `providers.js`: Import from `../validators/providerConfig`, add `validate()` to PUT and POST routes
   - `pool.js`: Import from `../validators/pool`, add `validate()` to POST routes
   - `compute-nodes.js`: Import from `../validators/computeNodes`, add `validate()` to POST/PUT routes
   - *Depends on*: Step 1

---

### c) Per-File Action Plan

#### `backend/src/validators/pool.js` (CREATE)
- **Exports**: `requestAgentSchema`, `releaseAgentSchema`
- **requestAgentSchema**: project_id (uuid, required), repo_url (uri, optional), provider_config (object, optional)
- **releaseAgentSchema**: agent_id (string, required)
- **Follow pattern**: `backend/src/validators/github.js`

#### `backend/src/validators/computeNodes.js` (CREATE)
- **Exports**: `createNodeSchema`, `updateNodeSchema`
- **createNodeSchema**: name (string 1-128, required), host (hostname, required), port (port, required), username (string, required), ssh_key (string, optional), max_agents (integer 1-100, default 4), tags (array of strings, optional)
- **updateNodeSchema**: Same as create but all fields optional

#### `backend/src/validators/providerConfig.js` (CREATE)
- **Exports**: `setProviderConfigSchema`, `testProviderConnectionSchema`
- **setProviderConfigSchema**: provider (enum, required), endpoint_url (uri, optional), model (string, required), api_key_credential_id (uuid, optional), fallback_provider (string, optional)
- **testProviderConnectionSchema**: endpoint_url (uri, required), model (string, optional), api_key (string, optional)

#### `backend/src/api/providers.js` (MODIFY)
- **Add import**: `const { setProviderConfigSchema, testProviderConnectionSchema } = require('../validators/providerConfig');`
- **Add validate to PUT** `/projects/:projectId/provider`: `validate(setProviderConfigSchema)`
- **Add validate to POST** `/projects/:projectId/provider/test`: `validate(testProviderConnectionSchema)`

#### `backend/src/api/pool.js` (MODIFY)
- **Add import**: `const { requestAgentSchema, releaseAgentSchema } = require('../validators/pool');`
- **Add validate to POST** `/pool/request`: `validate(requestAgentSchema)`
- **Add validate to POST** `/pool/release`: `validate(releaseAgentSchema)`

#### `backend/src/api/compute-nodes.js` (MODIFY - new file from PR 12)
- **Add import**: `const { createNodeSchema, updateNodeSchema } = require('../validators/computeNodes');`
- **Add validate to POST** `/`: `validate(createNodeSchema)`
- **Add validate to PUT** `/:id`: `validate(updateNodeSchema)`

---

### d) Dependencies

- `backend/src/middleware/validate.js` — existing validate middleware

---

### e) Risks/Edge Cases

- **[Breaking change]**: Adding validation where none existed before may reject previously-accepted input. Ensure schemas are permissive enough for all valid use cases.
- **[Optional fields]**: Make fields optional when the existing code handles missing values (`|| null`, `|| {}` patterns in services).

---

### f) Testing

#### Backend Unit Tests
- [ ] New tests in existing test files for each route's validation behavior
- [ ] Verify 400 response for invalid input on each route

#### CI Requirements
- [ ] `npm test` passes
- [ ] `npm run lint` passes

---

### g) Files Changed

**Backend:**
```
backend/src/validators/pool.js           → CREATE
backend/src/validators/computeNodes.js   → CREATE
backend/src/validators/providerConfig.js → CREATE
backend/src/api/providers.js             → MODIFY
backend/src/api/pool.js                  → MODIFY
backend/src/api/compute-nodes.js         → MODIFY
```
