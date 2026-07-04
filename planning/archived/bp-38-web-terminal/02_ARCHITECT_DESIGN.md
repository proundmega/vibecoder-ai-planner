# bp-38: Web Terminal Proxy — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

- Backend has middleware chain: helmet → cors → json → requestId → requestLogger → routes
- Route files are standard Express routers mounted under `/api/v1/`
- Frontend router uses lazy-loaded components with `meta.requiresAuth` and `meta.requiredPermission`
- Docker is available via `dockerode` npm package (added in bp-36 Pool Manager)
- No WebSocket support currently exists in the codebase

## Proposed Solution

### Architecture Overview

```
Browser (xterm.js)          Backend (Express)          Docker Daemon
     │                           │                          │
     │  wss://host/api/terminal/  │                          │
     │  ?token=<JWT>             │                          │
     │ ─────────────────────────>│                          │
     │                           │  Verify JWT (super_admin)│
     │                           │  ────────────────────────│
     │                           │                          │
     │                           │  docker.getContainer(id) │
     │                           │  .exec({ Cmd: ['/bin/bash'] })
     │                           │ ────────────────────────>│
     │                           │                          │
     │  WebSocket open           │  Exec stream started     │
     │ <─────────────────────────│ <────────────────────────│
     │                           │                          │
     │  stdin (keystrokes)       │  stream.write(data)      │
     │ ─────────────────────────>│ ────────────────────────>│
     │                           │                          │
     │  stdout/stderr            │  stream.on('data', ...)  │
     │ <─────────────────────────│ <────────────────────────│
     │                           │                          │
     │  resize {cols, rows}      │  exec.resize({w,h})     │
     │ ─────────────────────────>│ ────────────────────────>│
     │                           │                          │
     │  disconnect               │  stream.end()            │
     │ ─────────────────────────>│ ────────────────────────>│
```

### Data Flow

1. **Connection**: Frontend opens WebSocket to `ws://host/api/terminal/:agentId?token=<JWT>`
2. **Auth**: Backend upgrade handler reads JWT from query string, verifies super_admin role
3. **Exec**: Backend calls `docker.getContainer(agentId).exec()` with Tty:true
4. **Pipe**: Backend creates a duplex pipe between WebSocket and Docker exec stream
5. **Resize**: On xterm resize event, frontend sends `{type: "resize", cols: N, rows: N}` → backend calls `exec.resize()`
6. **Disconnect**: On WebSocket close, backend calls `stream.end()` and cleans up

### Route Setup

Instead of `express-ws` (which modifies the prototype of existing Router), we use the `ws` library directly with a WebSocketServer attached to the HTTP server, but route WebSocket upgrades through Express middleware manually:

```javascript
// In routes.js or a new terminal.js
const { verifyTokenWebSocket } = require('../middleware/auth');

// Mounted as a raw upgrade handler on the HTTP server
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/terminal/')) {
    terminalWs.handleUpgrade(request, socket, head, (ws) => {
      terminalWs.emit('connection', ws, request);
    });
  }
});
```

### Frontend TerminalView

```vue
<template>
  <div ref="terminalContainer" class="terminal-container"></div>
</template>

<script setup lang="ts">
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';

onMounted(() => {
  const term = new Terminal({ cursorBlink: true });
  term.open(terminalContainer.value);
  const ws = new WebSocket(url);
  const attachAddon = new AttachAddon(ws);
  term.loadAddon(attachAddon);
});
</script>
```

### Error Handling

| Error | Handling |
|-------|----------|
| Invalid/missing JWT | Close WebSocket with 4001 status code |
| Not super_admin | Close WebSocket with 4003 status code |
| Container not found | Close WebSocket with 4004, message "Agent container not found" |
| Container not running | Close WebSocket with 4004, message "Agent container is not running" |
| Docker exec fails | Close WebSocket with 5000, message "Failed to create terminal session" |
| WebSocket disconnect | Clean up Docker exec stream |

### Alternatives Considered

- **Option B: Separate WebSocket server on different port** — More complex deployment, need separate auth, CORS issues
- **Option C: SSH proxy instead of Docker exec** — Requires SSH server in each container, more overhead
- **Option D: Server-Sent Events for terminal output** — Can't send stdin input over SSE; bidirectional requires WebSocket

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/TerminalProxy.js` | CREATE | Docker exec → WebSocket bridge class |
| `backend/src/api/terminal.js` | CREATE | WebSocket upgrade handler, route definition |
| `backend/src/api/routes.js` | MODIFY | Attach WebSocket upgrade handler to HTTP server |
| `backend/src/middleware/auth.js` | MODIFY | Add `verifyTokenWebSocket()` for query-string JWT auth |
| `backend/package.json` | MODIFY | Add `express-ws` and `ws` |
| `frontend/src/views/TerminalView.vue` | CREATE | xterm.js terminal UI |
| `frontend/src/router/index.ts` | MODIFY | Add route `/agents/:id/terminal` with super_admin check |
| `frontend/src/api/terminal.js` | CREATE | `connectTerminal(agentId, token)` — returns WebSocket URL |
| `frontend/src/components/AgentList.vue` | MODIFY | Add terminal icon button for online agents |
| `frontend/package.json` | MODIFY | Add `xterm`, `@xterm/xterm`, `@xterm/addon-attach` |
