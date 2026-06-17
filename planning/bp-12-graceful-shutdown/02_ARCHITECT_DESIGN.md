# 02_ARCHITECT_DESIGN.md — Graceful Shutdown

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

No graceful shutdown handler. SIGTERM kills the process immediately, dropping in-flight requests and leaving database connections open.

---

## Current State

```javascript
// backend/src/index.js
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// No shutdown handler
```

---

## Design

### Graceful Shutdown Handler

```javascript
// backend/src/utils/shutdown.js
const logger = require('../utils/logger');

function gracefulShutdown(server, pool) {
  let shutdownInProgress = false;

  async function shutdown(signal) {
    if (shutdownInProgress) {
      logger.info('Shutdown already in progress. Forcing exit.');
      process.exit(1);
      return;
    }
    shutdownInProgress = true;
    
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    // Stop accepting new requests
    server.close(async () => {
      logger.info('HTTP server closed.');
      
      // Close database connections
      try {
        await pool.end();
        logger.info('Database connections closed.');
      } catch (err) {
        logger.error('Error closing database pool:', err);
      }
      
      logger.info('Graceful shutdown complete.');
      process.exit(0);
    });
    
    // Force exit after timeout
    setTimeout(() => {
      logger.error('Shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 30000); // 30 second timeout
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = gracefulShutdown;
```

### Usage

```javascript
// backend/src/index.js
const gracefulShutdown = require('./utils/shutdown');
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

gracefulShutdown(server, pool);
```

### Docker Integration

```yaml
# docker-compose.yml
services:
  api:
    stop_grace_period: 35s  # Allow time for graceful shutdown
```

### Alternative Designs Considered

- **Signal handler vs `process.on('exit')`** — Chose `SIGTERM`/`SIGINT` handlers over `exit` event because: `SIGTERM` provides a graceful shutdown window (the `exit` event is synchronous and cannot run async code). `process.on('exit')` was considered but rejected because: it does not support async operations — only synchronous code runs before the process exits.
- **Drain in-flight requests** — Chose `server.close()` (drain) over immediate shutdown because: it waits for existing connections to finish before closing the HTTP server. Immediate shutdown was considered but rejected because: it drops all in-flight requests mid-response, causing client errors (ERR_EMPTY_RESPONSE).
- **Database query cancellation** — Chose pool-level `pool.end()` over individual query cancellation because: `pool.end()` waits for active queries to complete and then releases all idle connections. Individual cancellation was considered but rejected because: it requires tracking every active query ID, sending `pg_cancel_backend()`, and handling partial results — which is complex and error-prone.

### Data Flow Diagram

```
Docker / SIGTERM signal
    ↓
[process.on('SIGTERM') → shutdown()]
    ↓
  [shutdownInProgress = true]
    ↓
  [server.close()] → stop accepting NEW requests
    ↓
  [in-flight requests finish?]
    ↓
  [pool.end()] → wait for active queries → close all connections
    ↓
  [30s timeout?]
    ├─ Yes → process.exit(1) (force)
    └─ No → process.exit(0) (graceful)
    ↓
Docker: container stopped (stop_grace_period: 35s)
```

### Config / Env Changes

- NEW: `backend/src/utils/shutdown.js` — graceful shutdown handler
- CHANGED: `backend/src/index.js` — import and call `gracefulShutdown(server, pool)` after `app.listen()`
- CHANGED: `docker-compose.yml` — add `stop_grace_period: 35s` to `api` service
- NEW: `backend/.env.example` — add `SHUTDOWN_TIMEOUT_MS=30000` (optional, defaults to 30s)

---

## Dependencies

- **None** — pure Node.js signal handling

---

## Risks/Edge Cases

- **[Long-running queries]**: If a query takes >30s, shutdown times out. Mitigation: increase timeout or kill queries.
- **[Multiple signals]**: SIGTERM then SIGKILL before timeout. Mitigation: `stop_grace_period` in Docker.
- **[Database connections]**: If pool.end() fails, shutdown hangs. Mitigation: timeout forces exit.
- **[PID 1 issue]**: In Docker, Node may not receive signals properly if not run as PID 1. Mitigation: use `init: true` in docker-compose or `tini` entrypoint.

---

*Ready for implementation phase.*
