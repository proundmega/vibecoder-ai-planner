# 02_ARCHITECT_DESIGN.md — API Versioning

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

All routes are under `/api/*` with no version. Breaking changes (field renames, endpoint removals) require coordinated frontend+backend updates.

---

## Current State

```
GET /api/users → [current schema]
GET /api/projects → [current schema]
```

No version prefix. No deprecation headers. No migration path.

---

## Design

### URL Path Versioning

```
/api/v1/users
/api/v1/projects
/api/v1/tickets
```

### Middleware

```javascript
// backend/src/middleware/apiVersion.js
function apiVersion(version = 'v1') {
  return (req, res, next) => {
    req.apiVersion = version;
    
    // Add deprecation header if not latest
    if (version !== 'v1') {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', '2026-12-31');
    }
    
    next();
  };
}
```

### Route Structure

```
backend/src/api/
  v1/
    users.js
    projects.js
    tickets.js
    ...
  index.js → mounts all versions
```

### Version Router

```javascript
// backend/src/api/index.js
const express = require('express');
const router = express.Router();

// Health and version endpoints (no version prefix)
router.get('/health', healthHandler);
router.get('/version', versionHandler);

// API v1
router.use('/v1', require('./v1'));

// Catch-all for unversioned requests
router.use((req, res) => {
  res.status(404).json({
    error: 'API version required. Use /api/v1/* endpoints.',
    availableVersions: ['v1'],
  });
});

module.exports = router;
```

### Frontend Integration

```javascript
// frontend/src/api/client.js
const API_BASE = '/api/v1';
```

### Alternative Designs Considered

- **Query parameter versioning (`/api/users?api-version=v1`)** — Chose URL path versioning over query param because: it is more RESTful, visible in OpenAPI spec, and easier to document. Query params were considered but rejected because: they are easy to forget, not visible in route documentation, and harder to enforce at the routing layer.
- **Header-based versioning (`Accept: application/vnd.vibecode.v1+json`)** — Chose URL path versioning over header-based because: it is simpler for clients to implement and debug (no custom Accept headers needed). Header-based was considered but rejected because: it adds complexity for frontend consumers, is harder to test with curl/browser, and Swagger UI does not handle it well.
- **URL path versioning with content negotiation (`/api/users` returns latest)** — Chose explicit version prefix over auto-routing because: it prevents accidental breaking changes and makes the contract explicit. Auto-routing was considered but rejected because: it creates ambiguity about which schema is returned and complicates deprecation tracking.

### Data Flow Diagram

```
Client Request: GET /api/v1/tickets
    ↓
[apiVersion middleware] → req.apiVersion = 'v1'
    ↓
[version router] → match /v1/* → route to src/api/v1/tickets.js
    ↓
[handler] → [service layer] → response
    ↓
Deprecation header added? (if version !== 'v1')
    ↓
Response with versioned data schema
```

### Config / Env Changes

- NEW: `backend/src/api/v1/` — directory for all versioned route modules
- NEW: `backend/src/middleware/apiVersion.js` — version middleware with deprecation headers
- CHANGED: `backend/src/api/index.js` — mount versioned routes under `/v1`
- CHANGED: `frontend/src/api/client.js` — update `API_BASE` from `/api` to `/api/v1`
- CHANGED: `frontend/vite.config.ts` — update proxy from `/api` to `/api/v1`
- CHANGED: `backend/src/api/openapi-spec.js` — update server URL to include `/v1` prefix

---

## Dependencies

- **None** — self-contained change
- **Frontend**: `API_BASE` constant needs update

---

## Risks/Edge Cases

- **[Downtime during migration]**: All routes move at once. Mitigation: deploy backend and frontend together.
- **[OpenAPI spec]**: Spec must reflect `/v1/` prefix. Update `openapi-spec.js` server URL.
- **[Swagger UI]**: Swagger UI serves at `/api/docs` — must still work with versioned routes.
- **[Frontend proxy]**: Vite proxy in `vite.config.ts` must proxy `/api/v1` to backend.

---

*Ready for implementation phase.*
