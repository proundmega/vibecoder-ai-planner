# bp-38: Web Terminal Proxy — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Large
**Scope**: Both

## Purpose
Super_admin can open an interactive shell in any agent container via browser-based terminal.

## Implementation Order

1. **Add npm dependencies** — `ws` (backend), `xterm` + `@xterm/xterm` + `@xterm/addon-attach` (frontend)
2. **Create TerminalProxy.js** — Backend service: Docker exec ↔ WebSocket bridge
3. **Create terminal.js** — Backend WebSocket upgrade route with JWT verification
4. **Modify routes.js** — Attach WebSocket upgrade handler to HTTP server
5. **Modify auth middleware** — Add `verifyTokenWebSocket()` for query-string token auth
6. **Create TerminalView.vue** — Frontend xterm.js component
7. **Create api/terminal.js** — Frontend WebSocket helper
8. **Modify router/index.ts** — Add route for `/agents/:id/terminal`
9. **Modify AgentList.vue** — Add terminal button

## Per-File Action Plan

### `backend/src/services/TerminalProxy.js` (CREATE)

```javascript
const Docker = require('dockerode');
const docker = new Docker();

class TerminalProxy {
  constructor(ws, agentId) {
    this.ws = ws;
    this.agentId = agentId;
    this.stream = null;
  }

  async start() {
    const container = docker.getContainer(this.agentId);
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-l'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    this.stream = await exec.start({ Tty: true, stdin: true });

    // Pipe Docker stdout → WebSocket
    this.stream.on('data', (chunk) => {
      this.ws.send(chunk.toString('base64'));
    });

    // Pipe Docker stderr → WebSocket
    this.stream.on('stderr', (chunk) => {
      this.ws.send(chunk.toString('base64'));
    });

    // Pipe WebSocket → Docker stdin
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'resize') {
        exec.resize({ w: msg.cols, h: msg.rows });
      } else if (msg.type === 'input') {
        this.stream.write(Buffer.from(msg.data, 'base64'));
      }
    });

    this.ws.on('close', () => this.cleanup());
    this.stream.on('end', () => this.ws.close());
  }

  cleanup() {
    if (this.stream) {
      try { this.stream.end(); } catch (e) { /* ignore */ }
      this.stream = null;
    }
  }
}

module.exports = TerminalProxy;
```

### `backend/src/api/terminal.js` (CREATE)

```javascript
const { verifyTokenWebSocket } = require('../middleware/auth');
const TerminalProxy = require('../services/TerminalProxy');

function setupTerminalWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const agentId = req.params.agentId;
    const terminal = new TerminalProxy(ws, agentId);
    terminal.start().catch(err => {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
    });
  });
}

module.exports = { setupTerminalWebSocket };
```

### `backend/src/api/routes.js` (MODIFY)

- After the HTTP server is created (in `src/index.js`), attach upgrade handler:
```javascript
const { setupTerminalWebSocket } = require('./terminal');
const WebSocket = require('ws');

// In index.js, after server.listen() or when creating server:
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  const match = url.pathname.match(/^\/api\/terminal\/([^/]+)$/);
  if (match) {
    verifyTokenWebSocket(url.searchParams.get('token'))
      .then((user) => {
        if (user.role !== 'super_admin') {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.requestedUrl = url;
          ws.user = user;
          wss.emit('connection', ws, request);
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      });
    return;
  }
  socket.destroy();
});

setupTerminalWebSocket(wss);
```

### `frontend/src/views/TerminalView.vue` (CREATE)

```vue
<template>
  <div class="terminal-page">
    <div class="terminal-header">
      <h2>Terminal: Agent {{ agentId }}</h2>
      <button @click="disconnect">Close</button>
    </div>
    <div ref="terminalContainer" class="terminal-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import { connectTerminal } from '../api/terminal';

const route = useRoute();
const router = useRouter();
const terminalContainer = ref<HTMLDivElement>();
const agentId = route.params.id as string;
let term: Terminal | null = null;
let ws: WebSocket | null = null;

onMounted(() => {
  if (!terminalContainer.value) return;
  
  term = new Terminal({ cursorBlink: true, fontSize: 14 });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalContainer.value);
  fitAddon.fit();

  ws = connectTerminal(agentId);
  const attachAddon = new AttachAddon(ws);
  term.loadAddon(attachAddon);

  term.onResize(({ cols, rows }) => {
    ws?.send(JSON.stringify({ type: 'resize', cols, rows }));
  });
});

function disconnect() {
  ws?.close();
  router.back();
}

onUnmounted(() => {
  ws?.close();
  term?.dispose();
});
</script>
```

### `frontend/src/api/terminal.js` (CREATE)

```typescript
export function connectTerminal(agentId: string): WebSocket {
  const token = localStorage.getItem('vibecode_token');
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  const url = `${protocol}://${host}/api/terminal/${agentId}?token=${token}`;
  return new WebSocket(url);
}
```

### `frontend/src/router/index.ts` (MODIFY)

Add route object:
```typescript
{
  path: '/agents/:id/terminal',
  name: 'AgentTerminal',
  component: () => import('../views/TerminalView.vue'),
  meta: { requiresAuth: true, requiredPermission: 'SUPER_ADMIN' },
}
```

Note: `SUPER_ADMIN` is not a real permission constant — the route guard must check `user.role === 'super_admin'` explicitly. Implement as a `beforeEnter` guard.

## Migration Plan
No database changes.

## Test Plan
1. Start agent container via pool manager
2. As super_admin, navigate to `/agents/:containerId/terminal`
3. Verify terminal renders with bash prompt
4. Run `ls`, `pwd`, `echo test` — verify output
5. Resize browser window — verify terminal resizes
6. Ctrl+C — verify signal passes through
7. Close browser tab — verify Docker exec session terminates
8. As non-super_admin user, verify 403

## Rollback Steps
1. Revert backend route changes
2. Remove frontend route + components
3. Remove npm packages
