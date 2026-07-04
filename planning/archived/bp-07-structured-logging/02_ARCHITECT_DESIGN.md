# 02_ARCHITECT_DESIGN.md — Structured Logging Format

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

Winston logs are plain text. Cannot be parsed by log aggregation services (Datadog, CloudWatch, ELK). Sensitive data may be logged in plain text.

---

## Current State

```javascript
// backend/src/utils/logger.js
const logger = winston.createLogger({
  format: winston.format.simple(),  // Plain text
  transports: [new winston.transports.Console()],
});

// Output: "2024-01-01T00:00:00.000Z [INFO] Starting Vibecode API..."
```

---

## Design

### JSON Formatter for File Logs

```javascript
// backend/src/utils/logger.js
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
```

### Structured Request Logger

```javascript
// backend/src/middleware/requestLogger.js
function requestLogger() {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.http('Request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        requestId: req.requestId,
        userId: req.user?.userId,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
    });
    next();
  };
}
```

### Sensitive Data Masking

```javascript
// backend/src/utils/logger.js
const sensitiveFields = ['password', 'token', 'apiKey', 'authorization', 'creditCard'];

function maskSensitive(obj) {
  const masked = { ...obj };
  for (const field of sensitiveFields) {
    if (masked[field]) masked[field] = masked[field].substring(0, 4) + '****';
  }
  return masked;
}
```

### Alternative Designs Considered

- **Pino over Winston** — Chose Winston over Pino because: Winston is already in use throughout the codebase, so switching would require rewriting all log calls. Pino was considered but rejected because: it uses a different API (`logger.info({ key: 'value' })` vs `logger.info('message', { key: 'value' })`), requiring changes to every log statement.
- **JSON everywhere (console + file)** — Chose dual-format (human-readable console, JSON file) over JSON everywhere because: developers reading logs in `docker logs` or `npm run dev` need readable output, while log aggregation tools need JSON. JSON everywhere was considered but rejected because: it makes local development harder to debug — parsing JSON from console output is tedious.
- **Bunyan over Winston** — Chose Winston over Bunyan because: Winston is already installed and has more ecosystem integrations (transports, formatters). Bunyan was considered but rejected because: it is less actively maintained and has fewer transport options.

### Data Flow Diagram

```
logger.info('message', { key: 'value' })
    ↓
[format: timestamp] → add ISO timestamp
    ↓
[format: errors] → extract stack traces
    ↓
[format: json] → serialize to JSON
    ↓
  ┌─────────────────────┬─────────────────────┐
  │ Console transport    │ File transport      │
  │ [colorize]           │ [error.log]          │
  │ [simple] → readable  │ [json] → machine    │
  └─────────────────────┴─────────────────────┘
    ↓
  [log aggregation: file logs only]
    ↓
  Datadog / CloudWatch / ELK parses JSON
```

### Config / Env Changes

- NEW: `backend/.env.example` — add `LOG_LEVEL=info` (default: info, options: error/warn/info/debug/http)
- CHANGED: `backend/src/utils/logger.js` — replace `simple()` format with dual-format (colorized+simple for console, json for files)
- NEW: `backend/src/middleware/requestLogger.js` — structured request logger
- CHANGED: `backend/src/index.js` — import and apply `requestLogger()` middleware
- NEW: `backend/src/utils/maskSensitive.js` — sensitive data masking utility

---

## Dependencies

- **Winston** — already installed
- **No new dependencies** — uses built-in formatters

---

## Risks/Edge Cases

- **[Console readability]**: JSON on console is hard to read. Use human-readable format for console, JSON for file.
- **[Sensitive data]**: Ensure all log calls use `maskSensitive()` or avoid logging sensitive fields.
- **[Log volume]**: JSON logs are larger. Monitor disk usage.

---

*Ready for implementation phase.*
