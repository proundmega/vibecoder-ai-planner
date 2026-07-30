# 02_ARCHITECT_DESIGN.md — Log File Rotation Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Winston logs to a single file (`logs/app.log`) with no rotation. In production, this can fill up disk space over time. Log file rotation is needed to prevent disk space exhaustion from unbounded log growth.

---

## Current State

### Existing Backend
- `backend/src/utils/logger.js` — Winston logger configured with console + file transports
- Log file: `logs/app.log` — single file, no rotation
- Log format: JSON (structured logging)
- No rotation, no compression, no retention policy

### Gap Analysis
- Single log file grows without bound
- No automatic cleanup of old logs
- No compression of rotated files
- No configurable retention

---

## Design

### Option A: winston-daily-rotate-file (Recommended)

```
Dependency:
  npm install winston-daily-rotate-file

Logger changes:
  backend/src/utils/logger.js
    → Replace winston.transports.File with winston-daily-rotate-file
    → Configure daily rotation: logs/app-%DATE%.log
    → Rotate daily at midnight
    → Keep 7 days of logs (maxFiles: 7)
    → Max 100MB per file (maxSize: '100m')
    → Compress rotated logs (zipped: true)
    → Keep console transport for local development
```

### Option B: Custom Rotation Script
- Cron job or node script to rotate logs
- **Cons**: More complex, error-prone, no compression built-in
- **Decision**: Use winston-daily-rotate-file — battle-tested, handles rotation automatically

### Option C: External Log Aggregation
- Ship logs to Datadog, CloudWatch, etc.
- **Cons**: Requires external service, out of scope
- **Decision**: Local rotation first, aggregation later (deferred to bp-XX-log-aggregation)

**Decision**: Option A — use winston-daily-rotate-file. Simple, well-maintained, handles rotation/compression/retention automatically.

---

## Configuration

### Logger Configuration

```javascript
const { createLogger, format, transports } = require('winston');
const RotateTransport = require('winston-daily-rotate-file');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'vibecode-api' },
  transports: [
    // Console transport (local development)
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    }),
    // Daily rotate transport (production)
    new RotateTransport({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zIndex: 1,
      rotatableFile: true,
      maxFiles: '7d', // Keep 7 days of logs
      maxSize: '100m', // Rotate if file exceeds 100MB
      zippedArchive: true, // Compress rotated logs
      format: format.combine(format.timestamp(), format.json())
    })
  ],
  exitOnError: false
});

module.exports = logger;
```

### Rotation Behavior
- **Daily**: At midnight (00:00), current `app.log` becomes `app-YYYY-MM-DD.log`
- **Size**: If `app.log` exceeds 100MB before midnight, rotate immediately
- **Retention**: Delete logs older than 7 days
- **Compression**: Rotated files are gzipped (e.g., `app-2025-07-12.log.gz`)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/logger.test.js` | Logger still works, writes to rotate transport |
| Manual verification | File system | `logs/` directory | Files rotate as expected |

### Test Cases

```javascript
// logger.test.js
describe('Logger - Daily Rotation', () => {
  it('writes logs to rotating file transport', () => {
    // Log a message
    // Assert file was created in logs/
  });

  it('keeps console transport active', () => {
    // Log a message
    // Assert console output received
  });

  it('logs in JSON format', () => {
    // Log a message
    // Assert log line is valid JSON
  });
});
```

---

## Risks and Edge Cases

### Backend Risks
- **[Disk space during rotation]**: Compressed + uncompressed file coexist briefly — Mitigation: Acceptable (brief window, compression reduces size)
- **[Log loss during rotation]**: Messages logged during rotation window — Mitigation: winston-daily-rotate-file handles this atomically
- **[Permission issues]**: `logs/` directory permissions — Mitigation: Ensure Docker volume has write permissions

### Edge Cases
- **[First run]**: No existing log files — Handle: Creates new `app-YYYY-MM-DD.log` automatically
- **[Multiple rotations in one day]**: File exceeds 100MB multiple times — Handle: winston-daily-rotate-file appends numeric suffix (app-2025-07-12-1.log, app-2025-07-12-2.log)
- **[Empty log directory]**: All logs rotated away — Handle: Creates new daily file automatically
- **[Docker volume persistence]**: `logs/` directory in Docker volume — Handle: Ensure volume mount includes `logs/`

---

## Alternative Designs Considered

### Alternative 1: winston-daily-rotate-file with Date Pattern
- Rotate by date only (no size limit)
- **Pros**: Simpler configuration
- **Cons**: Large log files if high traffic day
- **Decision**: Use both date AND size limits — best of both worlds

### Alternative 2: Separate Error Log
- Separate error logs into `error.log`
- **Pros**: Easier to find errors
- **Cons**: More files to manage
- **Decision**: Single log file for now (deferred to bp-XX-separate-error-logs)

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

Common goldmine categories:
- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | N/A | N/A | N/A | N/A | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "writes JSON log to rotating file")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
