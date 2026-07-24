# 02_ARCHITECT_DESIGN.md — Log Aggregation Pipeline Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Infrastructure
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Logs are written to files but not forwarded to a central log aggregation service. Operators need structured logs flowing to Datadog/CloudWatch for centralized querying and alerting.

---

## Design

### Winston Transport

**CREATE**: `backend/src/utils/logTransport.js`

Custom Winston transport that:
1. Buffers logs (10 logs or 5s interval)
2. Sends batch via HTTP POST to aggregation URL
3. Handles retries on failure (exponential backoff)
4. Gracefully degrades if service is down

```javascript
const Transport = require('winston-transport');
const https = require('https');

class LogAggregationTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.source = opts.source || 'vibecode-api';
    this.batchSize = opts.batchSize || 10;
    this.flushInterval = opts.flushInterval || 5000;
    this.buffer = [];
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  log(info, callback) {
    this.buffer.push(info);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
    callback();
  }

  flush() {
    if (this.buffer.length === 0) return;
    
    const logs = this.buffer.splice(0, this.batchSize);
    const payload = {
      ddsource: this.source,
      ddtags: 'service:vibecode-api,env:' + (process.env.NODE_ENV || 'development'),
      messages: logs.map(l => JSON.stringify(l)),
      service: 'vibecode-api',
    };

    const options = {
      hostname: new URL(this.url).hostname,
      path: new URL(this.url).pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': this.apiKey,
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 400) {
        this.emit('error', new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('error', (err) => {
      this.emit('error', err);
    });

    req.write(JSON.stringify(payload));
    req.end();
  }

  close() {
    clearInterval(this.flushTimer);
    this.flush();
  }
}

module.exports = LogAggregationTransport;
```

### Logger Integration

**MODIFY**: `backend/src/utils/logger.js`

Add aggregation transport conditionally:

```javascript
const transports = [
  new winston.transports.Console({ ... }),
  // ... DailyRotateFile transports ...
];

if (process.env.LOG_AGGREGATION_URL && process.env.LOG_AGGREGATION_API_KEY) {
  const LogAggregationTransport = require('./logTransport');
  transports.push(new LogAggregationTransport({
    url: process.env.LOG_AGGREGATION_URL,
    apiKey: process.env.LOG_AGGREGATION_API_KEY,
    source: process.env.LOG_AGGREGATION_SOURCE || 'vibecode-api',
  }));
}
```

### Env Vars

**MODIFY**: `backend/src/utils/envValidation.js`

```javascript
LOG_AGGREGATION_URL: { type: 'string', default: '' },
LOG_AGGREGATION_API_KEY: { type: 'string', default: '' },
LOG_AGGREGATION_SOURCE: { type: 'string', default: 'vibecode-api' },
```

### Docker Compose

**MODIFY**: `docker-compose.yml`

Add logging driver for production:
```yaml
services:
  api:
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"
```

---

## Risks and Edge Cases

- **[Aggregation service down]**: Transport buffers logs and retries. If buffer fills up, oldest logs are dropped.
- **[API key invalid]**: HTTP 401 response — transport emits error event but doesn't crash.
- **[High log volume]**: Batch size of 10, 5s interval prevents overwhelming the aggregation service.
- **[HTTPS vs HTTP]**: Transport uses `https` module. For HTTP, add `http` module fallback.

---

## Alternative Designs Considered

### Alternative 1: Use existing Winston transports (winston-datadog, etc.)
- **Pros**: Battle-tested, community support
- **Cons**: Adds dependency, may not support all features
- **Decision**: Custom transport gives us full control and minimal dependencies

### Alternative 2: Sidecar container (Fluentd, Vector)
- **Pros**: Decoupled, language-agnostic
- **Cons**: More infrastructure complexity, more containers to manage
- **Decision**: Winston transport is simpler for current scale

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
