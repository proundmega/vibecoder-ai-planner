# 01_ARCHITECT_REQUIREMENT.md — Environment Variable Validation

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

All required environment variables must be validated on startup. Missing variables should produce clear error messages, not cryptic runtime errors.

---

## Scope

- Validate all required env vars on app startup
- Provide clear error messages for missing/invalid variables
- Support `.env` file validation during development

---

## Assumptions

- `dotenv` is already installed (confirmed by `backend/package.json`)
- `.env` file loading is NOT currently done automatically (no `require('dotenv').config()` in `src/index.js`)
- The project uses `nodemon` for development (confirmed by `npm run dev` = `node --watch src/index.js`)
- `NODE_ENV` is already used to distinguish development/production (confirmed by existing code)
- Environment variables are loaded from `.env`, `.env.local`, or system environment (standard dotenv behavior)
- Validation should happen BEFORE any module that uses env vars is loaded (top of `src/index.js`)

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **Which env vars are required?**
   - DATABASE_URL
   - JWT_SECRET
   - NODE_ENV
   - Or more?

2. **Should we validate types?**
   - Yes — DATABASE_URL must be a valid PostgreSQL connection string
   - No — just check existence

3. **Should we load .env automatically?**
   - Yes — `dotenv` package loads `.env` on startup
   - No — require explicit `.env` loading in code

---

## Acceptance Criteria

- [ ] A validation module exists (e.g., `src/config/env.js`) that validates all required env vars
- [ ] Missing required env var produces a clear error message listing ALL missing variables (not just the first one)
- [ ] Invalid `DATABASE_URL` produces a clear error message (e.g., "DATABASE_URL must be a valid PostgreSQL connection string")
- [ ] App refuses to start (exits with code 1) when required env vars are missing or invalid
- [ ] Error messages include the env var name and a description of what is expected
- [ ] `.env.example` file is updated with all required env vars and placeholder values
- [ ] Validation runs before any database connection or JWT initialization
- [ ] Development environment (`.env` file) is validated the same way as production
- [ ] Unit tests verify validation module accepts valid configs and rejects invalid ones
- [ ] Linting passes with no errors

---

## Out of Scope

- Environment variable encryption or secrets management (HashiCorp Vault, AWS Secrets Manager)
- Environment variable hot-reloading (changes to `.env` without restart)
- Environment variable documentation generator (auto-generate `.env.example` from code)
- Environment variable schema validation for optional vars (only required vars are validated)
- CI environment variable validation (CI has its own secrets management)
- Docker secret support (Docker secrets — separate deployment concern)

---

## Testing Checklist

- [ ] Missing required env var produces clear error on startup
- [ ] Invalid DATABASE_URL produces clear error
- [ ] App starts successfully with all required env vars
- [ ] .env file is validated

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Silent failure (app starts but crashes later)
- ❌ Generic error message ("missing env var") — must say which one
- ❌ No validation at all

---

*Ready for design phase.*
