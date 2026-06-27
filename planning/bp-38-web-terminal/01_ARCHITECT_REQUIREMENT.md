# bp-38: Web Terminal Proxy (Phase 12)

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Large

## Problem Statement

When an agent produces unexpected results or gets stuck, the only way to debug is via the agent's Q&A feedback loop (bp-28). There is no way for a human operator to inspect the agent's container directly: check logs, run commands, examine the filesystem, or manually intervene. This makes debugging opaque and time-consuming.

## Scope

- **In scope**: WebSocket proxy that bridges a browser-based terminal into an agent container via `docker exec`. Super_admin-only access. Full terminal features via xterm.js.
- **Out of scope**: File viewer/editor (terminal only), file upload/download, multi-session sync, audit logging of terminal sessions.

## Acceptance Criteria

- [ ] Super_admin can navigate to `/agents/:id/terminal` and see a working terminal
- [ ] WebSocket connects at `ws://host/api/terminal/:agentId` — authenticated via JWT token in URL param
- [ ] Terminal renders via xterm.js with resize, clipboard paste, Ctrl+C, arrow keys working
- [ ] Backend creates a `docker exec` session on connection, pipes stdin/stdout/stderr bidirectionally
- [ ] Backend kills the `docker exec` session on WebSocket disconnect
- [ ] Non-super_admin users get 403 Forbidden on WebSocket upgrade
- [ ] AgentList.vue shows a terminal icon button for online agents

## Known Unknowns

- **Container exec availability**: The agent container must have `/bin/bash` or `/bin/sh` available. Alpine-based containers may need `/bin/sh -l` instead.
- **Tty sizing**: The terminal needs to send resize events to Docker exec. Docker exec handles SIGWINCH only when Tty=true.
- **Multiple concurrent sessions**: Two super_admins could connect to the same agent simultaneously. Docker supports multiple exec streams to the same container.

## Decisions Required

1. **WebSocket library for Express?**
   - Option A: `express-ws` — adds `.ws()` to Express routes, integrates with existing middleware chain
   - Option B: Raw `ws` library on separate port — requires separate auth handling
   - **Recommendation**: Option A — reuse existing Express auth middleware, requestId, and logging

2. **Auth mechanism for WebSocket upgrade?**
   - Option A: JWT token in query string (`?token=...`)
   - Option B: WebSocket handshake headers — not well supported by browser WebSocket API
   - **Recommendation**: Option A — token in query string, verified in upgrade middleware

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/TerminalProxy.js` | CREATE | Docker exec → WebSocket stream bridge |
| `backend/src/api/terminal.js` | CREATE | WebSocket upgrade route with JWT verification |
| `backend/src/api/routes.js` | MODIFY | Mount WebSocket upgrade middleware + route |
| `frontend/src/views/TerminalView.vue` | CREATE | Full xterm.js terminal component |
| `frontend/src/router/index.ts` | MODIFY | Add `/agents/:id/terminal` route with super_admin guard |
| `frontend/src/api/terminal.js` | CREATE | WebSocket connection helper |
| `frontend/src/components/AgentList.vue` | MODIFY | Add terminal icon button |
| `package.json` (backend) | MODIFY | Add `express-ws` and `ws` dependencies |
| `package.json` (frontend) | MODIFY | Add `xterm`, `@xterm/xterm`, `@xterm/addon-attach` |

## Dependencies

- **Depends on**: bp-36 (Pool Manager) — need agent containers to exist and be manageable
- **Depends on**: bp-33 (Agent Heartbeat) — need agent status to know which agents are online

## Performance Considerations

- Each terminal session creates a Docker exec stream. Memory per session is ~10-50MB depending on terminal output buffer.
- WebSocket overhead is minimal — raw terminal I/O is bandwidth-efficient.
- Docker daemon handles exec multiplexing. Resource limits per exec are not configurable via Dockerode.
