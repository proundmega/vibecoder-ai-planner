<template>
  <div class="notification-bell">
    <button
      type="button"
      class="bell-button"
      aria-label="Notifications"
      data-testid="notification-bell"
      @click="toggle"
    >
      <span class="bell-icon" aria-hidden="true">🔔</span>
      <span v-if="unread > 0" class="bell-badge" data-testid="notification-badge">
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </button>

    <div v-if="open" class="bell-dropdown" data-testid="notification-dropdown">
      <div class="bell-header">
        <span>Notifications</span>
        <router-link to="/questions" class="bell-inbox-link" @click="open = false">
          Open inbox
        </router-link>
      </div>
      <p v-if="loading" class="bell-status">Loading…</p>
      <p v-else-if="error" class="bell-status bell-error">{{ error }}</p>
      <p v-else-if="items.length === 0" class="bell-status">You're all caught up.</p>
      <ul v-else class="bell-list">
        <li v-for="item in items" :key="item.id" class="bell-item" :class="{ unread: !item.read_at }">
          <button type="button" class="bell-item-button" @click="openItem(item)">
            <strong>{{ labelFor(item) }}</strong>
            <span class="bell-preview">{{ previewFor(item) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  getUnreadCount,
  listNotifications,
  markNotificationRead,
  type NotificationItem,
} from '@/api/notifications'

const POLL_MS = 30_000

const unread = ref(0)
const items = ref<NotificationItem[]>([])
const open = ref(false)
const loading = ref(false)
const error = ref('')
let timer: ReturnType<typeof setInterval> | null = null

function labelFor(item: NotificationItem): string {
  switch (item.type) {
    case 'question':
      return 'A harness run is waiting for an answer'
    case 'run_succeeded':
      return 'Harness run succeeded'
    case 'run_failed':
      return 'Harness run failed'
    case 'budget_exceeded':
      return 'Harness budget exceeded'
    default:
      return 'Notification'
  }
}

function previewFor(item: NotificationItem): string {
  const payload = item.payload || {}
  return payload.preview
    || payload.error
    || payload.prUrl
    || payload.status
    || 'Open the inbox for details.'
}

async function refresh(): Promise<void> {
  try {
    unread.value = await getUnreadCount()
    if (open.value) {
      items.value = await listNotifications({ limit: 10 })
    }
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load notifications'
  }
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  loading.value = true
  try {
    items.value = await listNotifications({ limit: 10 })
    unread.value = await getUnreadCount()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load notifications'
  } finally {
    loading.value = false
  }
}

async function openItem(item: NotificationItem): Promise<void> {
  if (!item.read_at) {
    try {
      await markNotificationRead(item.id)
      await refresh()
    } catch {
      // A failed mark-read must not block navigation.
    }
  }
  open.value = false
}

function stopPolling(): void {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}

function startPolling(): void {
  stopPolling()
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return
  }
  timer = setInterval(refresh, POLL_MS)
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    stopPolling()
    return
  }
  refresh()
  startPolling()
}

onMounted(() => {
  refresh()
  startPolling()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
})

onBeforeUnmount(() => {
  stopPolling()
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})
</script>

<style scoped>
.notification-bell {
  position: relative;
}

.bell-button {
  position: relative;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 1.15rem;
  color: var(--color-nav-text, #e2e8f0);
  padding: 4px;
}

.bell-badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--color-danger, #dc2626);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  font-weight: 700;
}

.bell-dropdown {
  position: absolute;
  right: 0;
  top: 32px;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1f2937);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 8px 0;
  z-index: 50;
}

.bell-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px 8px;
  font-weight: 600;
}

.bell-inbox-link {
  font-size: 12px;
  color: var(--color-primary, #2563eb);
}

.bell-status {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-text-secondary, #64748b);
}

.bell-error {
  color: var(--color-danger, #dc2626);
}

.bell-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bell-item.unread {
  background: var(--color-bg-secondary, #f8fafc);
}

.bell-item-button {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.bell-preview {
  color: var(--color-text-secondary, #64748b);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
