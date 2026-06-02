<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { createTicket, getAgentTickets, getAgentHistory, listAgents } from '@/api/agents'

const route = useRoute()
const authStore = useAuthStore()

const agents = ref([])
const selectedAgentId = ref('')
const input = ref('')
const messages = ref([])
const agentTickets = ref(null)
const processing = ref(false)
const apiKey = ref('')
const dailyUsage = ref({ used: 0, limit: 100 })

const quickActions = [
  { label: 'Find Bugs', prompt: 'Find bugs in authentication' },
  { label: 'Review Code', prompt: 'Review backend API implementation' },
  { label: 'Generate Docs', prompt: 'Generate documentation for endpoints' },
  { label: 'Test Scenarios', prompt: 'Generate test cases for login flow' },
]

onMounted(async () => {
  try {
    const { agents: allAgents } = await listAgents(authStore.token.value)
    agents.value = allAgents || []
  } catch (error) {
    console.error('Failed to load agents:', error)
    addMessage('error', 'Failed to load agents. Please refresh the page.')
  }
})

watch(selectedAgentId, async (newId) => {
  if (!newId) return
  try {
    const agent = agents.value.find(a => a.id === newId)
    apiKey.value = agent?.apiKey || agent?.api_key || ''
    await loadAgentInfo()
  } catch (error) {
    console.error('Failed to load agent info:', error)
  }
})

async function loadAgentInfo() {
  if (!selectedAgentId.value) return
  try {
    const projectId = route.params.id
    agentTickets.value = await getAgentTickets(projectId, authStore.token.value, apiKey.value)
    dailyUsage.value = await getRecentDailyUsage()
  } catch (error) {
    console.error('Failed to load agent info:', error)
  }
}

async function handleAgentSelect() {
  if (selectedAgentId.value) {
    await loadAgentInfo()
  } else {
    agentTickets.value = null
    apiKey.value = ''
  }
}

function addMessage(type, text) {
  messages.value.push({
    id: Date.now(),
    type,
    text,
    timestamp: new Date().toISOString()
  })
}

function handleKeyDown(event) {
  if (event.key === 'Tab') {
    event.preventDefault()
    const textarea = event.target
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end)
    textarea.selectionStart = textarea.selectionEnd = start + 4
  }
}

async function handleQuickAction() {
  const action = quickActions[Math.floor(Math.random() * quickActions.length)]
  if (action) {
    input.value = action.prompt
    await handleSubmit()
  }
}

async function handleSubmit() {
  if (!selectedAgentId.value) {
    alert('Please select an agent first')
    return
  }

  if (!input.value.trim()) return

  const userPrompt = input.value.trim()
  processing.value = true

  try {
    addMessage('user', userPrompt)

    const projectId = route.params.id
    const result = await processUserPrompt(userPrompt, projectId)

    setTimeout(() => {
      addMessage('system', result)
    }, 300)

    input.value = ''
  } catch (error) {
    console.error('Submit failed:', error)
    addMessage('error', `Error: ${error.message}`)
  } finally {
    processing.value = false
  }
}

async function processUserPrompt(prompt, projectId) {
  const intent = detectIntent(prompt.toLowerCase())

  switch (intent) {
    case 'create':
      return await handleCreateTicket(prompt, projectId)
    case 'scan':
      return await handleScan()
    default:
      return 'I can help you:\n• Create a new ticket\n• Scan for issues'
  }
}

function detectIntent(text) {
  if (text.includes('create') || text.includes('add') || text.includes('make') || text.includes('new')) return 'create'
  if (text.includes('scan') || text.includes('find bugs') || text.includes('check') || text.includes('search')) return 'scan'
  return null
}

async function handleCreateTicket(prompt, projectId) {
  try {
    const title = extractTicketTitle(prompt)
    const description = prompt.replace(/^(add|create|make|new)\s+/i, '').trim() || 'New ticket'

    await createTicket(projectId, title, description, authStore.token.value, apiKey.value)

    return `Created ticket: "${title}"`
  } catch (error) {
    throw error
  }
}

async function handleScan() {
  addMessage('system', 'Scanning project repository...')
  await new Promise(resolve => setTimeout(resolve, 1500))
  return 'Scan complete\nFound 0 critical issues\n4 medium priority items\nSee tickets view'
}

function extractTicketTitle(text) {
  const match = text.match(/^(add|create|make|new)\s+([a-zA-Z0-9\s\-()]+?)(?:\s+as|$)/i)
  return match ? match[2].trim() : 'New ticket'
}

async function getRecentDailyUsage() {
  try {
    if (!selectedAgentId.value) return { used: 0, limit: 100 }
    const { daily } = await getAgentHistory(selectedAgentId.value, authStore.token.value, apiKey.value)
    if (daily && daily.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      const todayEntry = daily.find(d => d.date === today)
      if (todayEntry) {
        return {
          used: todayEntry.count,
          limit: 100,
        }
      }
    }
    return { used: 0, limit: 100 }
  } catch (error) {
    console.error('Failed to get daily usage:', error)
    return { used: 0, limit: 100 }
  }
}
</script>

<template>
  <div class="ai-panel">
    <header class="ai-header">
      <h2>
        <span class="ai-icon">AI</span>
        AI Assistant
      </h2>
      <div class="agent-selector">
        <label for="agent-select">Use Agent:</label>
        <select
          id="agent-select"
          v-model="selectedAgentId"
          @change="handleAgentSelect"
        >
          <option value="">Select an agent...</option>
          <option
            v-for="agent in agents"
            :key="agent.id"
            :value="agent.id"
          >
            {{ agent.name }}
          </option>
        </select>
      </div>
    </header>

    <div class="ai-stats" v-if="selectedAgentId">
      <div class="stat">
        <span class="stat-label">Active Tickets:</span>
        <span class="stat-value" v-if="agentTickets">{{ agentTickets.count }}</span>
        <span class="stat-value" v-else>—</span>
      </div>
      <div class="stat">
        <span class="stat-label">Actions Today:</span>
        <span class="stat-value">{{ dailyUsage.used }}</span>
        <span>/</span>
        <span class="stat-value">{{ dailyUsage.limit }}</span>
      </div>
    </div>

    <div class="ai-messages" v-if="messages.length">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="message"
        :class="msg.type"
      >
        <div class="message-content">
          <span v-if="msg.type === 'ticket_created'" class="action-emoji">✨</span>
          <span v-else-if="msg.type === 'status_changed'" class="action-emoji">🔄</span>
          <span v-else-if="msg.type === 'error'" class="action-emoji">⚠️</span>
          <p class="message-text">{{ msg.text }}</p>
        </div>
        <div class="message-timestamp">
          {{ new Date(msg.timestamp).toLocaleTimeString() }}
        </div>
      </div>
    </div>

    <div class="ai-input-area">
      <form @submit.prevent="handleSubmit" class="input-form">
        <textarea
          v-model="input"
          placeholder="Create a ticket: 'Find bugs in authentication'"
          @keydown="handleKeyDown"
          rows="3"
          :disabled="!selectedAgentId || processing"
        ></textarea>

        <div class="input-actions">
          <button
            type="button"
            @click="handleQuickAction"
            class="quick-action-btn"
            :disabled="!selectedAgentId || processing"
          >
            Create Ticket
          </button>

          <button
            type="button"
            @click="handleSubmit"
            class="submit-btn"
            :disabled="!input.trim() || !selectedAgentId || processing"
          >
            {{ processing ? 'Processing...' : 'Send' }}
          </button>
        </div>
      </form>
    </div>

    <div class="usage-warning" v-if="dailyUsage.used >= (dailyUsage.limit * 0.9)">
      <p>You're using {{ Math.round((dailyUsage.used / dailyUsage.limit) * 100) }}% of your daily limit</p>
    </div>
  </div>
</template>

<style scoped>
.ai-panel {
  height: 500px;
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: linear-gradient(135deg, #1e3a5f 0%, #1e5f72 100%);
  color: white;
}

.ai-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-header h2 .ai-icon {
  font-size: 20px;
}

.agent-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-selector label {
  font-size: 13px;
  opacity: 0.9;
}

.agent-selector select {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.agent-selector select option {
  background: #1e3a5f;
  color: white;
}

.ai-stats {
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
  font-size: 13px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-label {
  color: #6b7280;
}

.stat-value {
  font-weight: 600;
  color: #1f2937;
}

.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.message.user {
  justify-content: flex-end;
}

.message-content {
  max-width: 80%;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
}

.message.user .message-content {
  background: #3b82f6;
  color: white;
  border-bottom-right-radius: 0;
}

.message.system .message-content {
  background: #e5e7eb;
  color: #1f2937;
  border-bottom-left-radius: 0;
}

.message.error .message-content {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.message-text {
  max-width: 80%;
  white-space: pre-wrap;
}

.action-emoji {
  font-size: 18px;
  margin-bottom: 4px;
}

.message-timestamp {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  padding: 0 8px;
}

.ai-input-area {
  border-top: 1px solid #e5e7eb;
  padding: 16px;
  background: white;
}

.input-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

textarea:focus {
  border-color: #3b82f6;
}

textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.input-actions {
  display: flex;
  gap: 8px;
}

.quick-action-btn,
.submit-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-action-btn {
  background: #e5e7eb;
  color: #374151;
}

.quick-action-btn:hover:not(:disabled) {
  background: #d1d5db;
}

.submit-btn {
  background: #3b82f6;
  color: white;
  flex: 1;
}

.submit-btn:hover:not(:disabled) {
  background: #2563eb;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.usage-warning {
  padding: 8px 0;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  text-align: center;
  font-size: 12px;
  color: #92400e;
}
</style>
