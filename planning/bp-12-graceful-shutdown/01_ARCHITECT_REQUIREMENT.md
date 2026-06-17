# 01_ARCHITECT_REQUIREMENT.md — Graceful Shutdown

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

The API must handle SIGTERM/SIGINT signals gracefully: stop accepting new requests, drain in-flight requests, close database connections, and exit cleanly.

---

## Scope

- Handle SIGTERM and SIGINT signals
- Stop accepting new requests
- Wait for in-flight requests to complete (with timeout)
- Close database connection pool
- Exit with code 0 on clean shutdown

---

## Assumptions

- The Express app is started with `server.listen()` in `src/index.js`
- Database connection pool is managed by `pg.Pool` instance in `src/db.js`
- No WebSocket connections or long-lived connections need graceful disconnection
- No message queue consumers are running that need to drain
- The Java agent application does NOT need to be notified of shutdown (it polls and will reconnect)
- Docker Compose sends SIGTERM by default on `docker compose stop` or `docker compose down`
- `process.exit(0)` is NOT currently used anywhere in the codebase (would bypass shutdown handlers)

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **How long to wait for in-flight requests?**
   - 30 seconds (standard)
   - 60 seconds (more generous)
   - Configurable via env var `SHUTDOWN_TIMEOUT_MS`?

2. **Should we signal readiness/liveness probes?**
   - Yes — remove from load balancer before draining
   - No — just drain and exit

3. **Should we notify connected agents/websockets?**
   - Yes — send disconnect message before closing
   - No — agents will reconnect on timeout

---

## Acceptance Criteria

- [ ] SIGTERM signal handler is registered in `src/index.js`
- [ ] SIGINT signal handler is registered (Ctrl+C support)
- [ ] Server stops accepting new requests when shutdown begins (returns 503 or closes listening socket)
- [ ] In-flight requests are allowed to complete (up to the configured timeout)
- [ ] Database connection pool is closed (`pool.end()`) after in-flight requests complete
- [ ] Application exits with code 0 on clean shutdown
- [ ] Application exits with code 1 if shutdown times out (forced exit)
- [ ] Shutdown sequence is logged (shutdown started, draining, pool closing, exited)
- [ ] `SHUTDOWN_TIMEOUT_MS` env var is supported (default: 30000ms)
- [ ] Unit tests verify shutdown behavior (mocked `process.on`, `server.close`, `pool.end`)
- [ ] Linting passes with no errors

---

## Out of Scope

- Graceful shutdown for the Java agent application (separate codebase)
- Graceful shutdown for the frontend (nginx handles this)
- Database connection pool drain (wait for in-flight queries to finish — `pool.end()` handles this)
- Message queue consumer drain (no message queues currently in use)
- Kubernetes `preStop` hook configuration (separate orchestration concern)
- Health check during shutdown (container may be marked unhealthy during drain)
- Graceful shutdown for background jobs (no background job scheduler currently)

---

## Testing Checklist

- [ ] SIGTERM triggers graceful shutdown
- [ ] In-flight requests complete before exit
- [ ] Database connections closed
- [ ] Exit code is 0 (clean shutdown)
- [ ] New requests rejected during drain period

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ process.exit(0) without draining (drops in-flight requests)
- ❌ No shutdown handler (SIGTERM kills process abruptly)
- ❌ Infinite drain (never exits)

---

*Ready for design phase.*
