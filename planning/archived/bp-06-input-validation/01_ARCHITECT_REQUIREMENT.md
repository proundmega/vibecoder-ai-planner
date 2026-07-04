# 01_ARCHITECT_REQUIREMENT.md — Input Validation on All Endpoints

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

All endpoints that accept `req.body` must validate input using Joi schemas. Currently, some endpoints handle body directly without validation.

---

## Scope

- Create Joi schemas for endpoints missing validation (agents, approvals, memory, providers, credentials, github)
- Apply `validate()` middleware to all POST/PUT/PATCH endpoints
- Ensure consistent error handling for validation failures

---

## Assumptions

- `joi` is already installed as a dependency (confirmed by `backend/package.json`)
- `validate()` middleware already exists in `src/middleware/validate.js` and accepts a Joi schema
- Existing validators in `src/validators/` follow a consistent pattern (exported Joi objects)
- Endpoints that accept query params or path params are NOT in scope (only `req.body` validation)
- Validation errors should return HTTP 400 with a body containing the field names and error messages
- The `validate()` middleware already handles passing validation errors to the error handler

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **Should we create a schema for every endpoint?**
   - Yes — consistent validation everywhere
   - No — only validate endpoints with user-facing input

2. **Should schemas be in a single file or per-module?**
   - Per-module (`validators/agents.js`, `validators/approvals.js`, etc.) — follows existing pattern
   - Single file — easier to find all schemas

---

## Acceptance Criteria

- [ ] All POST/PUT/PATCH endpoints have a Joi validation schema
- [ ] Schemas are organized per-module in `src/validators/` (matching existing pattern)
- [ ] `validate()` middleware is applied to all endpoints that accept `req.body`
- [ ] Invalid input returns HTTP 400 with `{"success": false, "error": "...", "details": [...]}`
- [ ] Missing required fields return 400 with specific field names in the error message
- [ ] No endpoint accepts raw `req.body` without any schema validation
- [ ] Validation schemas include type, required, and reasonable constraints (min/max length, regex)
- [ ] Validation error messages are sanitized (no internal field names or stack traces exposed)
- [ ] Unit tests verify validation schemas accept valid input and reject invalid input
- [ ] Linting passes with no errors

---

## Out of Scope

- Query parameter validation (e.g., `?page=`, `?limit=`)
- Path parameter validation (e.g., `:id`)
- File upload validation (not currently supported)
- Request header validation
- Response schema validation (output validation — separate concern)
- Runtime type coercion (Joi `coerce` option — keep input types strict)
- Validation of nested objects beyond 1-2 levels deep

---

## Testing Checklist

- [ ] All POST/PUT/PATCH endpoints have Joi validation
- [ ] Invalid input returns 400 with error message
- [ ] Missing required fields return 400 with field names
- [ ] No endpoint accepts raw body without validation

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Skipping validation on "internal" endpoints
- ❌ Using `req.body` directly without schema validation
- ❌ Returning raw validation errors to client (must sanitize)

---

*Ready for design phase.*
