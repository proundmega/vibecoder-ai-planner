# BA-7: Monitoring & Logging

**Status**: planned
**Priority**: P3
**Effort**: Small
**Author**: Lead Architect
**Date created**: 2026-06-06
**Date completed**: —
**PR**: —
**Branch**: —

**Dependencies**: BA-6 (Response Handling)

**References:**
- `01_ARCHITECT_REQUIREMENT.md` → "Monitoring & Logging" section (Winston, request IDs, health checks, metrics)

---

### a) Purpose

Replace console logging with structured Winston logging. Winston is already installed but not being used. This ticket:

1. Create Winston logger configuration
2. Replace console logging with Winston
3. Add request logging middleware with structured format
4. Enhance health check with database status (already done in BA-6)
5. Add basic metrics endpoint (optional)

**Why:**
- Structured logging enables better log analysis and monitoring
- Winston supports multiple transports (console, file, etc.)
- Request IDs enable tracing across services
- Health checks enable monitoring and alerting

---

### b) Actions

#### Step 1: Create Winston Logger

Create `backend/src/utils/logger.js`:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'vibecode-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    ...(process.env.NODE_ENV === 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});

module.exports = logger;
```

#### Step 2: Update index.js to Use Winston

Replace `console.info` with Winston logger:

```javascript
const logger = require('./utils/logger');

logger.info('Starting Vibecode API...');
logger.info(`Vibecode API Server running on port ${PORT}`);
logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
```

#### Step 3: Add Request Logging Middleware

Create `backend/src/middleware/requestLogger.js`:

```javascript
const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  });
  
  next();
}

module.exports = { requestLogger };
```

#### Step 4: Add Metrics Endpoint

Update `routes.js` to add metrics endpoint:

```javascript
router.get('/metrics', (req, res) => {
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    },
    requestId: req.requestId,
  });
});
```

#### Step 5: Write Tests

Create `backend/src/__tests__/logger.test.js`:

```javascript
const logger = require('../utils/logger');

describe('Winston Logger', () => {
  it('should be defined', () => {
    expect(logger).toBeDefined();
  });

  it('should have info method', () => {
    expect(logger.info).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('should have error method', () => {
    expect(logger.error).toBeDefined();
    expect(typeof logger.error).toBe('function');
  });

  it('should have warn method', () => {
    expect(logger.warn).toBeDefined();
    expect(typeof logger.warn).toBe('function');
  });

  it('should log info messages', () => {
    const spy = jest.spyOn(logger, 'info');
    logger.info('Test message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should log error messages', () => {
    const spy = jest.spyOn(logger, 'error');
    logger.error('Test error');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Request Logger Middleware', () => {
  it('should log request information', () => {
    // Test will be added after middleware is created
  });
});
```

---

### c) Dependencies

- Existing: Winston (already installed), request ID middleware (BA-6)

---

### d) Risks/Edge Cases

- **Log injection**: User input in logs can inject malicious content. Use structured logging to avoid this.
- **Sensitive data**: Passwords, tokens, and PII should never be logged. Filter sensitive fields.
- **Log volume**: High-traffic endpoints can generate大量 logs. Consider sampling or aggregation.
- **Disk space**: File transports can fill up disk. Configure log rotation.

---

### e) Testing Checklist

- [ ] Winston logger is defined and has required methods
- [ ] Winston logger logs info messages
- [ ] Winston logger logs error messages
- [ ] Request logger middleware logs request information
- [ ] Request logger includes request ID
- [ ] Request logger includes duration
- [ ] Request logger includes status code
- [ ] Metrics endpoint returns uptime and memory usage
- [ ] Unit tests pass: `npm test`
- [ ] Lint passes: `npm run lint`

---

### f) Migration Plan

1. Create Winston logger (`utils/logger.js`)
2. Create request logger middleware (`middleware/requestLogger.js`)
3. Update `index.js` to use Winston logger
4. Add metrics endpoint to routes
5. Write unit tests
6. Update TICKETS.txt and AGENTS.md

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Monitoring & Logging section*
- *`02_ARCHITECT_DESIGN.md` → Role definitions, schema design*
- *`03_ARCHITECT_IMPLEMENTATION.md` → This template (purpose, actions, dependencies, risks, testing)*
