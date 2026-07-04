# bp-38: Web Terminal Proxy — Spec

**Target model**: 14B–34B (Express.js + Vue 3 + TypeScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/services/TerminalProxy.js`

**Imports**:
```javascript
const Docker = require('dockerode');
const logger = require('../utils/logger');
```

**Class**: `TerminalProxy`

**Fields**:
```
ws: WebSocket
agentId: String
stream: Docker.Modem | null
exec: Docker.Exec | null
```

**Methods**:
```javascript
constructor(ws, agentId)
  - stores ws, agentId

async start()
  1. container = docker.getContainer(this.agentId)
  2. this.exec = await container.exec({
       Cmd: ['/bin/bash', '-l'],
       AttachStdin: true,
       AttachStdout: true,
       AttachStderr: true,
       Tty: true,
     })
  3. this.stream = await this.exec.start({ Tty: true, stdin: true })
  4. logger.info('Terminal session started for container %s', this.agentId)
  5. this.stream.on('data', (chunk) => {
       const raw = chunk.toString('binary')
       this.ws.send(raw)
     })
  6. this.stream.on('end', () => this.ws.close())
  7. this.ws.on('message', (raw) => {
       const msg = JSON.parse(raw.toString())
       if (msg.type === 'input') {
         this.stream.write(Buffer.from(msg.data, 'base64'))
       } else if (msg.type === 'resize') {
         this.exec.resize({ w: msg.cols, h: msg.rows })
       }
     })
  8. this.ws.on('close', () => this.cleanup())

cleanup()
  1. if this.stream: try stream.end() catch noop
  2. this.stream = null
  3. this.exec = null
```

### CREATE: `backend/src/api/terminal.js`

**Imports**:
```javascript
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const TerminalProxy = require('../services/TerminalProxy');
const logger = require('../utils/logger');
```

**Functions**:
```javascript
function verifyTerminalToken(token)
  1. if !token: throw new Error('Missing token')
  2. decoded = jwt.verify(token, process.env.JWT_SECRET)
  3. return decoded  // { userId, role, ... }

function createTerminalWSS()
  1. wss = new WebSocket.Server({ noServer: true })
  2. wss.on('connection', (ws, req) => {
       const url = new URL(req.url, 'http://localhost')
       const agentId = url.pathname.split('/').pop()
       const proxy = new TerminalProxy(ws, agentId)
       proxy.start().catch(err => {
         logger.error('Terminal session error: %s', err.message)
         ws.close(1011, err.message)
       })
     })
  3. return wss
```

### MODIFY: `backend/src/index.js`

**Add**:
```javascript
const { createTerminalWSS } = require('./api/terminal');

// After app creation, before server.listen():
const wss = createTerminalWSS();

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  const token = url.searchParams.get('token');

  // Only handle /api/terminal/* paths
  if (!url.pathname.startsWith('/api/terminal/')) {
    socket.destroy();
    return;
  }

  try {
    const user = verifyTerminalToken(token);
    if (user.role !== 'super_admin') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});
```

### CREATE: `frontend/src/views/TerminalView.vue`

**Template**:
```vue
<template>
  <div class="terminal-page">
    <div class="terminal-header">
      <span>Agent Terminal — {{ agentId }}</span>
      <button class="btn btn-sm btn-secondary" @click="disconnect">✕ Close</button>
    </div>
    <div ref="terminalEl" class="terminal-container"></div>
  </div>
</template>
```

**Script**:
```typescript
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const route = useRoute()
const router = useRouter()
const terminalEl = ref<HTMLDivElement>()
const agentId = route.params.id as string

let term: Terminal
let ws: WebSocket

function getToken(): string {
  return localStorage.getItem('vibecode_token') || ''
}

function connectWs(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${protocol}://${window.location.host}/api/terminal/${agentId}?token=${getToken()}`
  return new WebSocket(url)
}

onMounted(() => {
  if (!terminalEl.value) return

  term = new Terminal({ cursorBlink: true, fontSize: 14 })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(terminalEl.value)
  fit.fit()

  ws = connectWs()

  ws.onopen = () => { term.focus() }

  ws.onmessage = (event) => {
    // Binary data from Docker exec — write directly to terminal
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(buf => term.write(new Uint8Array(buf)))
    } else {
      term.write(event.data)
    }
  }

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: btoa(data) }))
    }
  })

  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  })

  ws.onclose = () => { term.write('\r\n\x1b[31mConnection closed\x1b[0m\r\n') }
})

function disconnect() {
  ws?.close()
  router.back()
}

onUnmounted(() => {
  ws?.close()
  term?.dispose()
})
```

**Styles** (scoped):
```css
.terminal-page { height: 100vh; display: flex; flex-direction: column; }
.terminal-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; background: #1a1a2e; color: #fff; }
.terminal-container { flex: 1; background: #000; padding: 4px; }
```

### MODIFY: `frontend/src/router/index.ts`

**Add import**: none (lazy import inline)

**Add route** (inside routes array):
```typescript
{
  path: '/agents/:id/terminal',
  name: 'AgentTerminal',
  component: () => import('../views/TerminalView.vue'),
  meta: { requiresAuth: true },
  beforeEnter: (_to, _from, next) => {
    const userStr = localStorage.getItem('vibecode_user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        if (user.role === 'super_admin') return next()
      } catch { /* ignore */ }
    }
    next({ name: 'Dashboard' })
  },
}
```

### MODIFY: `frontend/src/components/AgentList.vue`

**Add column header**:
```html
<th v-if="isSuperAdmin">Terminal</th>
```

**Add cell**:
```html
<td v-if="isSuperAdmin">
  <button
    v-if="agent.status === 'online'"
    class="btn btn-sm btn-icon"
    title="Open terminal"
    @click="openTerminal(agent.containerId)"
  >⌘</button>
</td>
```

**Add method**:
```typescript
function openTerminal(containerId: string) {
  router.push(`/agents/${containerId}/terminal`)
}
```

**Add computed**:
```typescript
const isSuperAdmin = computed(() => {
  const userStr = localStorage.getItem('vibecode_user')
  if (!userStr) return false
  return JSON.parse(userStr).role === 'super_admin'
})
```

## Test Expectations

### Backend (manual)
```
✓ WebSocket upgrade with valid super_admin JWT → connection accepted
✓ WebSocket upgrade with valid non-super_admin JWT → 403
✓ WebSocket upgrade without token → 401
✓ Docker exec session created on connection
✓ stdin from WebSocket reaches Docker exec
✓ Docker exec stdout/stderr reaches WebSocket
✓ Resize events sent to Docker exec
✓ WebSocket disconnect → Docker exec session cleaned up
```

### Frontend (manual)
```
✓ TerminalView renders at /agents/:id/terminal
✓ xterm.js shows bash prompt
✓ Keyboard input works (ls, cd, pwd)
✓ Clipboard paste works (Ctrl+Shift+V then Ctrl+D)
✓ Ctrl+C terminates foreground process
✓ Resize terminal → content reflows
✓ Close button → returns to previous route
✓ Non-super_admin → redirected to Dashboard
```

## Edge Cases to Handle

1. **Container not found**: WebSocket closes with 4004 status code
2. **Container not running**: WebSocket closes with 4004, message "Container not running"
3. **Multiple connections**: Two super_admins can connect to same container — Docker supports it
4. **Rapid reconnect**: Client should wait 1s before attempting reconnect
5. **Large output**: Docker exec stream can produce large output (e.g. `cat largefile`). Buffer at 64KB chunks.
6. **Binary output**: `docker exec` may return binary data. Use base64 encoding for WebSocket transport.
7. **Container dies during session**: Docker stream emits 'end' → WebSocket closes
8. **Agent container has no bash**: Only `/bin/sh` available. Backend should fallback to `['/bin/sh']` if `['/bin/bash', '-l']` fails.

## Existing Code Patterns to Follow

- `dockerode` already added as dependency (bp-36)
- Express middleware pattern: async handlers wrapped in `.catch(next)`
- Frontend uses native `fetch` for API (not axios)
- Router uses lazy `() => import(...)` for all components
- Permission checks in `localStorage.getItem('vibecode_user')` pattern
- CSS: BEM-lite naming, scoped styles
- Logger: winston via `require('../utils/logger')`
