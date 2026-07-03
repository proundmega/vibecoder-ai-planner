# 02_ARCHITECT_DESIGN.md — Database Connection Pooling Configuration

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

`pg.Pool` is created in `backend/src/db.js` with no explicit configuration. Default max of 20 connections may be insufficient under load, and idle connections are never released.

---

## Current State

```javascript
// backend/src/db.js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

- No `max` connections configured (defaults to 20)
- No `idleTimeoutMillis` (connections stay open indefinitely)
- No `connectionTimeoutMillis` (hangs when pool exhausted)
- No pool health monitoring

---

## Design

### Pool Configuration

```javascript
// backend/src/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DATABASE_POOL_MAX) || 20,
  idleTimeoutMillis: 30000,      // Close idle connections after 30s
  connectionTimeoutMillis: 5000,  // Fail fast if no connection available in 5s
  maxUses: 10000,                 // Recycle connections after 10k uses
});

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Export pool stats
pool.stats = () => ({
  totalCount: pool.totalCount,
  idleCount: pool.idleCount,
  waitingCount: pool.waitingCount,
});
```

### Pool Stats on /metrics

```javascript
router.get('/metrics', (req, res) => {
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      database: {
        ...pool.stats(),
        status: pool.idleCount > 0 ? 'healthy' : 'degraded',
      },
    },
    requestId: req.requestId,
  });
});
```

### Alternative Designs Considered

- **PgBouncer proxy** — Chose direct pool configuration over PgBouncer because: it adds no infrastructure dependency and works well for single-instance deployments. PgBouncer was considered but rejected because: it requires a separate Docker service, connection pooling configuration, and adds a network hop for every query.
- **Per-query timeout** — Chose pool-level `connectionTimeoutMillis` over per-query `query_timeout` because: it provides a consistent fail-fast behavior across all queries without modifying every call site. Per-query timeout was considered but rejected because: it requires wrapping every `pool.query()` call and the pg driver's `statement_timeout` GUC is less precise for connection exhaustion.
- **Dynamic pool sizing** — Chose static pool size over dynamic sizing because: it avoids complexity of runtime pool resizing and the `max` env var is configurable per environment. Dynamic sizing was considered but rejected because: the `pg` pool does not support resizing without recreating the pool, which risks dropping in-flight connections.

### Data Flow Diagram

```
Request
    ↓
pool.query()
    ↓
  [idle client available?]
    ├─ Yes → borrow client → execute query → release client
    └─ No  → waitingCount++
                ↓
          [connectionTimeoutMillis elapsed?]
            ├─ Yes → reject with "no available connection"
            └─ No  → wait...
                ↓
          [idle timeout elapsed?]
            ↓
      pool.on('error') → process.exit(-1)
```

### Config / Env Changes

- NEW: `backend/.env.example` — add `DATABASE_POOL_MAX=20`, `DATABASE_IDLE_TIMEOUT_MS=30000`, `DATABASE_CONNECTION_TIMEOUT_MS=5000`, `DATABASE_MAX_USES=10000`
- CHANGED: `backend/src/db.js` — add pool configuration options, error handler, and stats method
- NEW: `backend/src/api/routes.js` — add `/metrics` endpoint exposing pool stats (optional)

---

## Dependencies

- **None** — self-contained change to `db.js`
- **Optional**: PgBouncer Docker service for production

---

## Risks/Edge Cases

- **[Pool exhaustion]**: All 20 connections in use → new queries wait 5s then fail. Mitigation: increase `max` or add PgBouncer.
- **[Connection leaks]**: Code that calls `pool.connect()` but never `client.release()` → pool fills up. Mitigation: always use `pool.query()` or `pool.transaction()`.
- **[Stale connections]**: Database restarts → connections die. Mitigation: `pool.on('error')` handler, `maxUses` recycling.
- **[Production scaling]**: 20 connections may not be enough for high traffic. Mitigation: make `max` configurable via env var.

---

*Ready for implementation phase.*
