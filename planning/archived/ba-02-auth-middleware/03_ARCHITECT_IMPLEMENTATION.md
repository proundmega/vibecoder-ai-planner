# BA-2: Authentication Middleware

**Status**: planned
**Priority**: P0
**Effort**: Small
**Dependencies**: None

---

### a) Purpose

Authentication middleware verifies the identity of every request. It extracts the JWT from the `Authorization` header, validates its signature and expiry, attaches the decoded user payload to `req.user`, and rejects unauthenticated requests before they reach route handlers.

### b) Actions

1. Create `middleware/auth.js` (already exists — audit for consistency)
2. Implement `verifyToken` middleware:
   - Extract token from `Authorization: Bearer <token>` header
   - Validate JWT signature using `JWT_SECRET`
   - Check token expiry (`exp` claim)
   - Attach decoded payload to `req.user`
   - Call `next()` on success, `res.status(401)` on failure
3. Implement `agentAuth` middleware for API key-based agent access:
   - Check `X-API-Key` header
   - Validate against `agents` table
   - Attach `req.agent` with agent details
4. Apply middleware selectively:
   - Public routes: `/api/auth/register`, `/api/auth/login`, `/api/health`
   - Authenticated routes: `/api/projects/*`, `/api/tickets/*`, `/api/users/*`
   - Agent routes: `/api/agents/*`
5. Centralize `JWT_SECRET` in one place (`.env` or config module)

**Current issues to fix:**
- `JWT_SECRET` is duplicated in `middleware/auth.js` and `auth.js` — consolidate
- `UserService.authenticate()` re-declares `JWT_SECRET` locally — remove duplication
- Token expiry format should use `${TOKEN_EXPIRY_MINUTES}m` consistently

**Example middleware:**
```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET, TOKEN_EXPIRY_MINUTES } = process.env;

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { verifyToken };
```

### c) Dependencies
- `jsonwebtoken` (already in `package.json`)
- `process.env.JWT_SECRET` (must be set)
- `process.env.TOKEN_EXPIRY_MINUTES` (optional, default `30`)
- Database pool for agent lookup (optional, for API key auth)

### d) Risks/Edge Cases
- **Secret rotation**: Changing `JWT_SECRET` invalidates all existing tokens — plan migration
- **Clock skew**: Token expiry depends on server clock — NTP drift could cause premature expiry
- **Token leakage**: Tokens in URL query params or logs — never log full tokens
- **Algorithm confusion**: JWT library should specify `algorithms: ['HS256']` to prevent algorithm switching attacks
- **Missing header**: Empty `Authorization` header should return 401, not 500
- **Agent vs user auth**: Mixing `X-API-Key` and `Bearer` tokens — ensure middleware doesn't conflict

### e) Testing
- [ ] Valid JWT → `next()` called, `req.user` populated
- [ ] Expired JWT → 401 with "Token expired"
- [ ] Invalid signature → 401 with "Invalid token"
- [ ] Missing header → 401 with "Authorization header required"
- [ ] Agent API key → `req.agent` populated
- [ ] JWT_SECRET centralized (no duplicates)

---
