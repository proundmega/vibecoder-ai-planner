# 03_ARCHITECT_IMPLEMENTATION.md — Structured Logging Format

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-07-structured-logging

**Dependencies**: None

---

### a) Purpose

Configure Winston to output JSON logs for file storage (log aggregation) and human-readable logs for console (development). Add structured fields and sensitive data masking.

**Value delivered**: Logs can be piped to Datadog/CloudWatch/ELK. Sensitive data is masked.

---

### b) Actions

1. **Update logger config** — `backend/src/utils/logger.js`
   - JSON format for file transports
   - Human-readable format for console (dev)
   - Add `maskSensitive()` helper

2. **Create request logger middleware** — `backend/src/middleware/requestLogger.js`
   - Adds `requestId`, `userId`, `ip`, `method`, `path`, `status`, `duration` to logs

3. **Apply middleware** — `backend/src/index.js`
   - Use `requestLogger()` after routes

4. **Update .env.example** — `backend/.env.example`
   - Add `LOG_LEVEL=info` comment

5. **Create tests**
   - `backend/src/__tests__/structuredLogging.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Console readability]**: JSON on console is hard to read. Use human-readable format for console.
- **[Sensitive data]**: Audit all log calls to ensure no passwords/tokens are logged.

---

### e) Testing

#### Unit Tests
- [ ] JSON format outputs valid JSON
- [ ] Sensitive fields are masked
- [ ] Request logger adds structured fields

#### Integration Tests
- [ ] File logs contain JSON
- [ ] Console logs are human-readable

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/utils/logger.js` — CHANGED
- `backend/src/middleware/requestLogger.js` — NEW
- `backend/src/index.js` — CHANGED
- `backend/.env.example` — CHANGED
- `backend/src/__tests__/structuredLogging.test.js` — NEW

---

### h) Code Review Checklist

- [ ] JSON log format includes all required structured fields
- [ ] Sensitive fields (password, token, apiKey, authorization) are masked in all log outputs
- [ ] Console format is human-readable (colored, simple format)
- [ ] File format is valid JSON (one object per line)
- [ ] Request logger does not capture request body for POST/PUT (privacy)
- [ ] requestId is unique per request (use nanoid or similar)

---

### i) Post-Deploy Verification

- [ ] File logs are valid JSON (pipe through `jq .` to verify)
- [ ] Console logs are readable in development
- [ ] No sensitive data appears in log files
- [ ] Log aggregation pipeline ingests JSON logs correctly
- [ ] Request duration field is present and reasonable

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Console: human-readable (colored, simple)
- File: JSON (for log aggregation)
- Structured fields: requestId, userId, ip, method, path, status, duration
- Sensitive fields masked: password, token, apiKey, authorization

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, logger config, request logger*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
