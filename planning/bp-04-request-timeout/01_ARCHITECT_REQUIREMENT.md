# 01_ARCHITECT_REQUIREMENT.md — Request Timeout

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

All HTTP requests must have a timeout to prevent slow queries from hanging indefinitely and consuming connections.

---

## Scope

- Add request timeout middleware (30s default)
- Configurable timeout per endpoint (longer for report endpoints)
- Return 408 Request Timeout with clear error message
- Log slow requests for monitoring

---

## Assumptions

- The project uses Express.js (confirmed by `src/index.js` and `src/api/routes.js`)
- No existing timeout middleware is in place (confirmed by absence in `src/middleware/`)
- The `express-timeout-handler` or similar package is NOT currently a dependency
- Database queries can take longer than the default timeout for complex operations (aggregations, large result sets)
- Agent polling requests (`GET /tickets/next`) should NOT be subject to the same timeout as user-facing endpoints
- The Java agent application may have its own HTTP client timeout that should be coordinated

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **What's the default timeout?**
   - 30 seconds (standard for web APIs)
   - 60 seconds (more lenient)
   - Configurable via env var `REQUEST_TIMEOUT_MS`?

2. **Should some endpoints have longer timeouts?**
   - Yes — `/billing`, `/usage`, `/memory/search` may take longer
   - No — enforce uniform timeout for simplicity

3. **Should we use a library or custom middleware?**
   - Custom middleware (no new dependency)
   - `express-timeout-handler` (battle-tested, more features)

---

## Acceptance Criteria

- [ ] Default request timeout is 30000ms (30 seconds)
- [ ] Timeout is configurable via `REQUEST_TIMEOUT_MS` environment variable
- [ ] Requests exceeding the timeout return HTTP 408 with body `{"success": false, "error": "Request timeout"}`
- [ ] Specific endpoints (`/billing`, `/usage`, `/memory/search`) can have longer timeouts via middleware config
- [ ] Slow requests (approaching timeout) are logged at `warn` level with endpoint, duration, and IP
- [ ] Normal requests complete within the timeout without interference
- [ ] Timeout does NOT apply to agent polling endpoints (or has a separate, longer timeout)
- [ ] Unit tests verify timeout behavior with mocked `setTimeout`
- [ ] Linting passes with no errors

---

## Out of Scope

- Database query-level timeouts (handled by pg.Pool `connectionTimeoutMillis`)
- WebSocket connection timeouts (no WebSocket implementation currently)
- Timeout for file uploads (not currently supported)
- Distributed trace timeout propagation (OpenTelemetry, etc.)
- Timeout UI on the frontend (showing "request is taking long" indicators)
- Retry logic for timed-out requests

---

## Testing Checklist

- [ ] Request exceeding timeout returns 408
- [ ] Normal requests complete within timeout
- [ ] Slow requests are logged
- [ ] Timeout is configurable via env var

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ No timeout at all (hangs forever, consumes connections)
- ❌ Too short timeout (3s) — breaks legitimate slow queries
- ❌ Silent timeout (must return 408 with clear message)

---

*Ready for design phase.*
