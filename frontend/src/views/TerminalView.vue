<template>
  <div class="terminal-page">
    <div class="terminal-header">
      <span>Agent Terminal — {{ agentId }}</span>
      <button class="btn btn-sm btn-secondary" @click="disconnect">✕ Close</button>
    </div>
    <div ref="terminalEl" class="terminal-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const route = useRoute()
const router = useRouter()
const terminalEl = ref<HTMLDivElement>()
const agentId = route.params.id as string

let term: Terminal | null = null
let ws: WebSocket | null = null

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

  ws.onopen = () => { term?.focus() }

  ws.onmessage = (event) => {
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(buf => term?.write(new Uint8Array(buf)))
    } else {
      term?.write(event.data)
    }
  }

  term.onData((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: btoa(data) }))
    }
  })

  term.onResize(({ cols, rows }) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  })

  ws.onclose = () => { term?.write('\r\n\x1b[31mConnection closed\x1b[0m\r\n') }
})

function disconnect() {
  ws?.close()
  router.back()
}

onUnmounted(() => {
  ws?.close()
  term?.dispose()
})
</script>

<style scoped>
.terminal-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #1a1a2e;
  color: #fff;
  font-size: 0.875rem;
}

.btn {
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
}

.btn-secondary {
  background: #4a5568;
  color: white;
}

.btn-secondary:hover {
  background: #2d3748;
}

.terminal-container {
  flex: 1;
  background: #000;
  padding: 4px;
}
</style>
