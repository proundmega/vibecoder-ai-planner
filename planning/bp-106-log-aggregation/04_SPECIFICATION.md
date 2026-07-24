# 04_SPECIFICATION.md — Log Aggregation Pipeline Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

---

## File Operations

### CREATE: `backend/src/utils/logTransport.js`

```javascript
const Transport = require('winston-transport');
const https = require('https');
const http = require('http');;

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
    if (callback) callback();
  }

  flush() {
    if (this.buffer.length === 0) return;
    
    const logs = this.buffer.splice(0, this.batchSize);
    const payload = {
      ddsource: this.source,
      ddtags: `service:vibecode-api,env:${process.env.NODE_ENV || 'development'}`,
      messages: logs.map(l => JSON.stringify(l)),
      service: 'vibecode-api',
    };

    const url = new URL(this.url);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': this.apiKey,
      },
      timeout: 5000,
    };

    const req = lib.request(options, (res) => {
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

### MODIFY: `backend/src/utils/envValidation.js`

**Add to `optionalEnvVars`** (after existing entries):

```javascript
LOG_AGGREGATION_URL: { type: 'string', default: '' },
LOG_AGGREGATION_API_KEY: { type: 'string', default: '' },
LOG_AGGREGATION_SOURCE: { type: 'string', default: 'vibecode-api' },
```

### MODIFY: `backend/src/utils/logger.js`

**Add conditional transport** after the `DailyRotateFile` transports (before closing `transports` array):

```javascript
// Conditionally add log aggregation transport
if (process.env.LOG_AGGREGATION_URL && process.env.LOG_AGGREGATION_API_KEY) {
  const LogAggregationTransport = require('./logTransport');
  transports.push(new LogAggregationTransport({
    url: process.env.LOG_AGGREGATION_URL,
    apiKey: process.env.LOG_AGGREGATION_API_KEY,
    source: process.env.LOG_AGGREGATION_SOURCE || 'vibecode-api',
  }));
}
```

### MODIFY: `docker-compose.yml`

**Add logging driver** to the `api` service:

```yaml
services:
  api:
    # ... existing config ...
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"
```

### CREATE: `backend/src/__tests__/logTransport.test.js`

```javascript
const LogAggregationTransport = require('../utils/logTransport');

describe('LogAggregationTransport', () => {
  it('emits logs in JSON format', () => {
    // Create transport, log a message, verify buffer contains JSON
  });

  it('sends to aggregation URL', () => {
    // Mock HTTP request, verify payload format
  });

  it('handles errors gracefully', () => {
    // Simulate HTTP error, verify transport doesn't crash
  });
});
```

---

## Test Expectations

### Backend Unit Tests — Log Transport
```
✓ [happy] Transport emits logs in JSON format
✓ [happy] Transport sends batch to aggregation URL
✓ [happy] Transport handles HTTP errors gracefully
✓ [happy] Transport buffers logs (10 logs or 5s interval)
✓ [happy] Console transport still works when aggregation is configured
✓ [edge] Transport doesn't crash when aggregation service is down
```

---

## Edge Cases to Handle

1. **[Aggregation service down]**: Transport buffers logs and retries. If buffer fills up, oldest logs are dropped.
2. **[API key invalid]**: HTTP 401 response — transport emits error event but doesn't crash.
3. **[High log volume]**: Batch size of 10, 5s interval prevents overwhelming the aggregation service.
4. **[HTTPS vs HTTP]**: Transport detects protocol and uses appropriate module.

---

## Existing Code Patterns to Follow

- Backend uses CommonJS (`require`, `module.exports`)
- Winston transports extend `winston-transport`
- Optional env vars follow the pattern in `envValidation.js`
- Conditional transport addition (only when env vars are set)

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `backend/src/utils/logger.js` — Console transport unchanged
- `backend/src/middleware/` — middleware uses logger, no changes needed
- `frontend/` — no frontend changes needed

---

*This specification is the contract between planning and execution.*
