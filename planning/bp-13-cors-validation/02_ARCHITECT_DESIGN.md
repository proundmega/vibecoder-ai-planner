# 02_ARCHITECT_DESIGN.md — CORS Validation

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

No explicit CORS configuration. Either using permissive defaults or no CORS headers, which can lead to security issues or broken cross-origin requests.

---

## Current State

```javascript
// backend/src/index.js
// No CORS configuration
```

---

## Design

### CORS Middleware

```javascript
// backend/src/middleware/cors.js
function cors(allowedOrigins = []) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
      
      if (req.method === 'OPTIONS') {
        return res.status(204).send();
      }
    } else {
      return res.status(403).json({
        success: false,
        error: {
          code: 'CORS_ERROR',
          message: 'Origin not allowed',
        },
      });
    }
    
    next();
  };
}
```

### Configuration

```javascript
// backend/src/index.js
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors(allowedOrigins));
```

### .env.example

```env
# CORS configuration
ALLOWED_ORIGINS=http://localhost:3000,https://app.vibecode.ai
```

### Alternative Designs Considered

- **cors npm package over custom middleware** — Chose custom middleware over `cors` npm package because: it provides full control over the logic (including 403 for disallowed origins) without relying on a third-party package. The `cors` package was considered but rejected because: its default behavior allows all origins (`origin: true`), which is insecure, and customizing the 403 response requires workarounds.
- **Wildcard origin (`*`) over explicit origins** — Chose explicit origin list over wildcard because: the API uses credentials (`Authorization` header), and CORS spec forbids `*` with `Access-Control-Allow-Credentials: true`. Wildcard was considered but rejected because: it is insecure when credentials are involved and does not work with authenticated API calls.
- **CORS at reverse proxy level over application level** — Chose application-level CORS over Nginx-level CORS because: it works regardless of deployment topology (direct Docker, behind Nginx, behind cloud load balancer). Nginx-level was considered but rejected because: it requires Nginx configuration changes and does not work when the backend is accessed directly (e.g., local development).

### Data Flow Diagram

```
Client Request (cross-origin)
    ↓
  [browser sends Origin header]
    ↓
[cors middleware]
    ↓
  [origin in allowedOrigins list?]
    ├─ Yes → set CORS headers → next()
    │           ↓
    │       [handler] → response
    │           ↓
    │       Browser receives: Access-Control-Allow-Origin: <origin>
    │       Browser allows response
    │
    └─ No  → 403 CORS_ERROR
                ↓
            Browser blocks response
    ↓
  [preflight: OPTIONS request]
    ↓
  [cors middleware] → 204 No Content + CORS headers
    ↓
  Browser sends actual request
```

### Config / Env Changes

- NEW: `backend/src/middleware/cors.js` — CORS middleware with origin validation
- NEW: `backend/.env.example` — add `ALLOWED_ORIGINS=http://localhost:3000,https://app.vibecode.ai`
- CHANGED: `backend/src/index.js` — import and apply `cors()` middleware at the top of the middleware chain
- CHANGED: `backend/src/api/routes.js` — ensure OPTIONS preflight requests are handled (middleware-level, not route-level)

---

## Dependencies

- **None** — pure Express middleware

---

## Risks/Edge Cases

- **[Wildcard origin]**: Never use `*` with credentials. Must specify exact origin.
- **[Development vs production]**: Different origins for each environment. Use env var.
- **[Preflight caching]**: `Access-Control-Max-Age: 86400` caches preflight for 24h. Update if CORS config changes.
- **[Subdomains]**: `https://app.vibecode.ai` doesn't match `https://dev.app.vibecode.ai`. List all subdomains explicitly.

---

*Ready for implementation phase.*
