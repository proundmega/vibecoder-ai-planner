# 02_ARCHITECT_DESIGN.md — Configurable Log Rotation Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Log rotation settings are hardcoded in `logger.js` (`maxFiles: '7d'`, `maxSize: '100m'`, `zippedArchive: true`). Operators cannot tune retention without code changes.

---

## Design

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOG_ROTATION_DAYS` | int | 7 | Number of days to keep rotated logs |
| `LOG_ROTATION_MAX_SIZE` | string | '100m' | Max file size before rotation (e.g., '100m', '500m', '1g') |
| `LOG_ROTATION_COMPRESS` | boolean | true | Whether to gzip compressed rotated logs |

### Logger Changes

```javascript
// logger.js
const rotationDays = parseInt(process.env.LOG_ROTATION_DAYS || '7', 10);
const rotationMaxSize = process.env.LOG_ROTATION_MAX_SIZE || '100m';
const rotationCompress = process.env.LOG_ROTATION_COMPRESS !== 'false';

// In DailyRotateFile config:
new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxFiles: `${rotationDays}d`,
  maxSize: rotationMaxSize,
  zippedArchive: rotationCompress,
  format: logFormat,
})
```

### Env Validation Changes

```javascript
// envValidation.js optionalEnvVars
LOG_ROTATION_DAYS: { type: 'int', default: 7 },
LOG_ROTATION_MAX_SIZE: { type: 'string', default: '100m' },
LOG_ROTATION_COMPRESS: { validValues: ['true', 'false'], default: 'true' },
```

---

## Risks and Edge Cases

- **[Invalid max size format]**: winston-daily-rotate-file will reject invalid sizes at startup. No validation needed — the library handles it.
- **[LOG_ROTATION_COMPRESS='0']**: We treat anything other than the literal string `'false'` as truthy. So `'0'`, `'no'`, `'false'` — only `'false'` disables compression.
- **[Docker volumes]**: `logs/` directory must be in Docker volume mount. Already handled in existing docker-compose.yml.

---

## Alternative Designs Considered

### Alternative 1: JSON config file
- **Pros**: More structured, supports nested config
- **Cons**: Requires file I/O, harder to override in Docker
- **Decision**: Env vars are simpler and Docker-native

### Alternative 2: Separate env vars per transport
- **Pros**: Fine-grained control (error vs combined)
- **Cons**: 6 env vars instead of 3, most users want same settings
- **Decision**: Shared settings for now (deferred if needed)

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Edge cases are enumerated explicitly
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
