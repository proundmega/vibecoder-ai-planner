# 01_ARCHITECT_REQUIREMENT.md — Configurable Log Rotation via Environment Variables

**Status**: planned
**Date created**: 2025-07-24
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P3 (Developer Experience)
**Effort**: Small

---

## Requirement

Log rotation settings (retention days, max file size, compression) are hardcoded in `logger.js`. Make them configurable via environment variables so operators can tune retention without code changes.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Logger exists: `backend/src/utils/logger.js` — DailyRotateFile transports with hardcoded `maxFiles: '7d'`, `maxSize: '100m'`, `zippedArchive: true`
- [x] Env validation exists: `backend/src/utils/envValidation.js` — optional env vars with defaults pattern already in use
- [x] Docker volumes: `logs/` directory is already mounted via docker-compose.yml

### Key Insight

The logger already uses `winston-daily-rotate-file`. The only change needed is reading rotation config from env vars with sensible defaults. The pattern already exists in `envValidation.js` for other optional vars.

---

## Scope

### In Scope
- Add env vars to `envValidation.js`: `LOG_ROTATION_DAYS`, `LOG_ROTATION_MAX_SIZE`, `LOG_ROTATION_COMPRESS`
- Read these env vars in `logger.js` and pass to DailyRotateFile transports
- Defaults: 7 days, 100MB, gzip compression (same as current behavior)
- Tests: verify logger works with defaults and custom values

### Out of Scope
- Log aggregation pipeline (separate ticket: bp-106)
- Per-transport config (error vs combined) — both share the same settings
- Runtime config reload without restart

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/utils/envValidation.js` | MODIFY | Add LOG_ROTATION_DAYS, LOG_ROTATION_MAX_SIZE, LOG_ROTATION_COMPRESS |
| `backend/src/utils/logger.js` | MODIFY | Read env vars and pass to DailyRotateFile transports |
| `backend/src/__tests__/logger.test.js` | MODIFY | Add tests for env var overrides |

---

## Acceptance Criteria

1. [ ] `LOG_ROTATION_DAYS` defaults to 7, configurable via env
2. [ ] `LOG_ROTATION_MAX_SIZE` defaults to '100m', configurable via env
3. [ ] `LOG_ROTATION_COMPRESS` defaults to true, configurable via env
4. [ ] Logger works with defaults (same behavior as before)
5. [ ] Logger works with custom values (e.g., LOG_ROTATION_DAYS=14)
6. [ ] Console transport unchanged
7. [ ] All existing logger tests still pass
8. [ ] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Log aggregation pipeline
- Per-transport config
- Runtime config reload without restart

---

## Performance Considerations

- Env var parsing is synchronous at startup — no runtime overhead
- No new npm dependencies

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: verify logger works with default env vars
- [ ] Unit tests: verify logger works with custom env vars
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
