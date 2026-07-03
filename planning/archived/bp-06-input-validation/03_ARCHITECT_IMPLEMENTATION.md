# 03_ARCHITECT_IMPLEMENTATION.md — Input Validation on All Endpoints

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-06-input-validation

**Dependencies**: None

---

### a) Purpose

Add Joi validation schemas to all endpoints that accept `req.body`. Currently agents, approvals, memory, providers, credentials, and github endpoints handle raw body without validation.

**Value delivered**: Consistent input validation across all endpoints. Prevents invalid data from reaching the database.

---

### b) Actions

1. **Create Joi schemas** — `backend/src/validators/`
   - `agents.js` — createTicket, editTicket, claimTicket, statusChange
   - `approvals.js` — createApproval
   - `memory.js` — addMemory, updateMemory
   - `providers.js` — addProvider, updateProvider
   - `credentials.js` — addCredential, updateCredential
   - `github.js` — connectRepo, createBranch, createPR

2. **Apply validate middleware** to all route files
   - `backend/src/api/agents.js`
   - `backend/src/api/approvals.js`
   - `backend/src/api/memory.js`
   - `backend/src/api/providers.js`
   - `backend/src/api/credentials.js`
   - `backend/src/api/github.js`

3. **Create tests**
   - `backend/src/__tests__/validationAgents.test.js`
   - `backend/src/__tests__/validationApprovals.test.js`
   - `backend/src/__tests__/validationMemory.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Backward compatibility]**: New validation may reject previously accepted input. Use permissive schemas first.
- **[Agent API]**: Agents may send non-JSON body. Ensure validation handles this gracefully.

---

### e) Testing

#### Unit Tests
- [ ] Invalid input returns 400 with error details
- [ ] Missing required fields return 400 with field names
- [ ] Valid input passes validation

#### Integration Tests
- [ ] All POST/PUT/PATCH endpoints validate input
- [ ] No endpoint accepts raw body without validation

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/validators/agents.js` — NEW
- `backend/src/validators/approvals.js` — NEW
- `backend/src/validators/memory.js` — NEW
- `backend/src/validators/providers.js` — NEW
- `backend/src/validators/credentials.js` — NEW
- `backend/src/validators/github.js` — NEW
- `backend/src/api/agents.js` — CHANGED
- `backend/src/api/approvals.js` — CHANGED
- `backend/src/api/memory.js` — CHANGED
- `backend/src/api/providers.js` — CHANGED
- `backend/src/api/credentials.js` — CHANGED
- `backend/src/api/github.js` — CHANGED
- `backend/src/__tests__/validationAgents.test.js` — NEW
- `backend/src/__tests__/validationApprovals.test.js` — NEW
- `backend/src/__tests__/validationMemory.test.js` — NEW

---

### h) Code Review Checklist

- [ ] All Joi schemas include required fields and type constraints
- [ ] Validation error messages are clear and actionable
- [ ] 400 responses include field-level error details
- [ ] Agent API endpoints handle non-JSON body gracefully
- [ ] No sensitive data (passwords, tokens) included in validation schemas
- [ ] Existing tests still pass after validation is added

---

### i) Post-Deploy Verification

- [ ] Monitor 400 error rate for 15 minutes — expect initial spike then stabilization
- [ ] Verify all agent clients can still submit valid requests
- [ ] Check that validation errors are user-friendly in API responses
- [ ] Confirm no previously valid requests are now rejected

---

### j) Migration Notes

None — pure code change. Test with existing agent clients.

---

### k) Notes

- All POST/PUT/PATCH endpoints must have Joi validation
- Schemas go in `backend/src/validators/` directory
- Follow existing pattern: `validate(schema)` middleware

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, Joi schemas, validation middleware*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
