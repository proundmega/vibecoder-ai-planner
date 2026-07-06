# 01_ARCHITECT_REQUIREMENT.md — Add Joi Input Validation to Missing Routes

**Status**: planned
**Date created**: 2026-06-29
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Medium

---

## Requirement

Several PRs introduced backend mutation routes (POST/PUT) that accept request body without Joi validation middleware. Missing validation allows malformed input to reach service logic, increasing risk of SQL errors, data corruption, or injection attacks. The following routes lack validation:

| PR | Routes | Missing validation |
|----|--------|-------------------|
| 7 (bp-29) | PUT `/providers/projects/:projectId/provider`, POST `/providers/projects/:projectId/provider/test` | 2 routes |
| 8 (bp-36) | POST `/pool/request`, POST `/pool/release`, GET `/pool/status` | 2 mutation routes |
| 12 (bp-40) | POST `/compute-nodes`, PUT `/compute-nodes/:id` | 2 routes |
| 13 (bp-41) | POST `/providers/:projectId/provider/resolve` | 1 route |

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Validator pattern exists: `backend/src/validators/providers.js`, `backend/src/validators/tickets.js` — YES
- [x] Validate middleware exists: `backend/src/middleware/validate.js` — YES
- [x] Existing schemas follow Joi patterns — YES

### Key Insight
The project already has a `validate` middleware and numerous Joi schema examples. This is purely additive — create new schema files and add `validate(schema)` middleware to existing routes.

---

## Scope

### In Scope
- Create `backend/src/validators/pool.js` with `requestAgentSchema` and `releaseAgentSchema`
- Create `backend/src/validators/computeNodes.js` with `createNodeSchema` and `updateNodeSchema`
- Create `backend/src/validators/providerConfig.js` with `setProviderConfigSchema` (separate from the existing provider credential schemas)

### Out of Scope
- Rate limiting — separate concern
- Auth/permissions changes — already exist on these routes

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/providers.js` | MODIFY | Add validate middleware to provider config PUT/POST/test routes |
| `backend/src/api/pool.js` | MODIFY | Add validate middleware to pool request/release POST routes |
| `backend/src/api/compute-nodes.js` | MODIFY | Add validate middleware to compute node POST/PUT routes |
| `backend/src/validators/pool.js` | CREATE | Joi schemas for pool routes |
| `backend/src/validators/computeNodes.js` | CREATE | Joi schemas for compute node routes |
| `backend/src/validators/providerConfig.js` | CREATE | Joi schemas for provider config routes |

---

## Acceptance Criteria

1. [ ] [Backend] All mutation routes listed above validate input via Joi schemas
2. [ ] [Backend] Invalid inputs return 400 with proper error details
3. [ ] [Backend] `npm test` passes
4. [ ] [Backend] `npm run lint` passes

---

## Security Considerations

- [x] Input validation: YES — Joi schemas for all new mutation endpoints
- [x] SQL injection protection: Already handled by parameterized queries in services
- [ ] Rate limiting: Not required for admin/internal endpoints
