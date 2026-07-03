# 03_ARCHITECT_IMPLEMENTATION.md — Environment Variable Validation

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-10-env-validation

**Dependencies**: None

---

### a) Purpose

Validate all required environment variables on startup with clear error messages for missing/invalid values.

**Value delivered**: Developers get clear errors instead of cryptic runtime failures.

---

### b) Actions

1. **Create env validator** — `backend/src/utils/env.js`
   - Define `requiredEnvVars` list
   - Validate existence and format of each var
   - Exit with clear error message if any fail

2. **Call on startup** — `backend/src/index.js`
   - Import and call `validateEnv()` before app setup

3. **Update .env.example** — `backend/.env.example`
   - Add all required and optional env vars with descriptions

4. **Create tests**
   - `backend/src/__tests__/envValidation.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Production env vars]**: CI/CD pipelines must set all required vars. Document in deployment guide.
- **[Secret rotation]**: JWT_SECRET change invalidates existing tokens. Document in migration notes.

---

### e) Testing

#### Unit Tests
- [ ] Missing required env var exits with clear error
- [ ] Invalid DATABASE_URL format exits with error
- [ ] Short JWT_SECRET exits with error
- [ ] All valid env vars allow app to start

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/utils/env.js` — NEW
- `backend/src/index.js` — CHANGED
- `backend/.env.example` — CHANGED
- `backend/src/__tests__/envValidation.test.js` — NEW

---

### h) Code Review Checklist

- [ ] All required env vars are listed (DATABASE_URL, JWT_SECRET, NODE_ENV)
- [ ] Validation provides clear, actionable error messages
- [ ] DATABASE_URL format validation uses regex for `postgresql://` pattern
- [ ] JWT_SECRET minimum length check (32 characters)
- [ ] App exits with non-zero code on validation failure
- [ ] .env.example documents all required and optional vars

---

### i) Post-Deploy Verification

- [ ] Start app locally with missing env vars — verify clear error message
- [ ] Start app with valid env vars — verify it starts normally
- [ ] Check CI/CD pipeline has all required env vars set
- [ ] Verify no cryptic runtime errors in production logs after deployment

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Required vars: DATABASE_URL, JWT_SECRET, NODE_ENV
- DATABASE_URL must match `postgresql://` pattern
- JWT_SECRET must be at least 32 characters
- Clear error messages with variable names and suggestions

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, validator, .env.example*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
