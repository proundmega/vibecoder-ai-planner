<template>
  <div class="ai-panel">
    <header class="ai-header">
      <h2>
        <span class="ai-icon">🤖</span>
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
            {{ agent.name }} (API Key: {{ agent.api_key || 'N/A' }})
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
        <span class="stat-value">{{ dailyUsage?.used }}</span>
        <span class="stat-divider">/</span>
        <span class="stat-value">{{ dailyUsage?.limit }}</span>
      </div>
    </div>

    <div class="ai-messages" v-if="messages.length">
      <div 
        v-for="msg in messages" 
        :key="msg.id" 
        class="message"
        :class="msg.role"
      >
        <div class="message-content">
          <span v-if="msg.type === 'ticket_created'" class="action-emoji">✨</span>
          <span v-else-if="msg.type === 'status_changed'" class="action-emoji">🔄</span>
          <span v-else-if="msg.type === 'ticket_claimed'" class="action-emoji">📌</span>
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
            @click="handleScan"
            class="scan-btn"
            :disabled="!selectedAgentId || processing"
          >
            Scan Issues
          </button>
          
          <button 
            type="submit" 
            class="submit-btn"
            :disabled="!input.trim() || !selectedAgentId || processing"
          >
            {{ processing ? 'Processing...' : 'Send →' }}
          </button>
        </div>
      </form>
    </div>

    <div class="usage-warning" v-if="dailyUsage && dailyUsage.used >= (dailyUsage.limit * 0.9)">
      <p>⚡ You're using {{ Math.round((dailyUsage.used / dailyUsage.limit) * 100) }}% of your daily limit</p>
      <p>Limit resets at midnight UTC</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { createTicket, updateTicket, claimTicket, changeTicketStatus, getAgentTickets, getAgentHistory, getAgentKeyInfo, createAgent, listAgents } from '@/api/agents'

const route = useRoute()
const authStore = useAuthStore()

const agents = ref([])
const selectedAgentId = ref('')
const input = ref('')
const messages = ref([])
const agentTickets = ref(null)
const processing = ref(false)
const apiKey = ref('')
const dailyUsage = ref(null)

const tickets = computed(() => agentTickets.value?.tickets || [])
const count = computed(() => agentTickets.value?.count || 0)

const quickActions = [
  { label: 'Find Bugs', prompt: 'Find bugs in authentication' },
  { label: 'Review Code', prompt: 'Review backend API implementation' },
  { label: 'Generate Docs', prompt: 'Generate documentation for endpoints' },
  { label: 'Test Scenarios', prompt: 'Generate test cases for login flow' },
]

// Load agents on mount
onMounted(async () => {
  try {
    await loadAgents()
  } catch (error) {
    console.error('Failed to load agents:', error)
    addMessage('error', 'Failed to load agents. Please refresh the page.')
  }
})

// Watch for selected agent changes
watch(selectedAgentId, async (newId) => {
  if (!newId) return
  
  try {
    const agent = agents.value.find(a => a.id === newId)
    apiKey.value = agent?.api_key || ''
    await loadAgentInfo()
  } catch (error) {
    console.error('Failed to load agent info:', error)
  }
})

// Load all agents for the user
async function loadAgents() {
  try {
    const { agents: allAgents } = await listAgents(authStore.token)
    agents.value = allAgents || []
  } catch (error) {
    console.error('Failed to list agents:', error)
  }
}

// Load agent-specific info
async function loadAgentInfo() {
  if (!selectedAgentId.value) return
  
  try {
    agentTickets.value = await getAgentTickets(route.params?.projectId, authStore.token, apiKey.value)
    dailyUsage.value = await getRecentDailyUsage()
  } catch (error) {
    console.error('Failed to load agent info:', error)
  }
}

// Handle agent selection change
async function handleAgentSelect() {
  if (selectedAgentId.value) {
    await loadAgentInfo()
  } else {
    agentTickets.value = null
    apiKey.value = ''
  }
}

// Add message to chat
function addMessage(type, text) {
  messages.value.push({
    id: Date.now(),
    type,
    text,
    timestamp: new Date().toISOString()
  })
  
  // Auto-scroll to bottom
  const scrollContainer = document.querySelector('.ai-messages')
  if (scrollContainer) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight
  }
}

// Handle input key combinations
function handleKeyDown(event) {
  if (event.key === 'Tab') {
    event.preventDefault()
    insertText('    ')
  }
}

// Insert text at cursor position
function insertText(text) {
  const textarea = event.target
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = textarea.value
  textarea.value = value.substring(0, start) + text + value.substring(end)
  textarea.selectionStart = textarea.selectionEnd = start + text.length
}

// Handle quick action button
async function handleQuickAction() {
  const action = quickActions.find(a => a.label === quickActions.findLast?.(a => a.label)?.label)
  if (action) {
    quickActions.forEach(a => {
      if (a.label === action.label) {
        input.value = a.prompt
        processInput()
      }
    })
  }
}

// Handle form submission
async function handleSubmit() {
  if (!selectedAgentId.value) {
    alert('Please select an agent first')
    return
  }

  if (!input.value.trim()) return

  const userPrompt = input.value.trim()
  processing.value = true
  
  try {
    // Add user message
    addMessage('user', userPrompt)
    
    // Parse intent and process
    const result = await processUserPrompt(userPrompt)
    
    // Add system response
    setTimeout(() => {
      addMessage('system', result)
    }, 300)
    
    input.value = ''
  } catch (error) {
    addMessage('error', `Error: ${error.message}`)
  } finally {
    processing.value = false
  }
}

// Process user intent
async function processUserPrompt(prompt) {
  // Simple intent detection (in production, use NLP/AI service)
  const intent = detectIntent(prompt.toLowerCase())
  
  switch (intent) {
    case 'create':
      return await handleCreateTicket(prompt)
    case 'status':
      return await handleChangeStatus(prompt)
    case 'claim':
      return await handleClaim(prompt)
    case 'scan':
      return await handleScan(prompt)
    default:
      return 'I\'d help with that! Please specify if you want to:\n• Create a new ticket\n• Change a ticket status\n• Claim a ticket\n• Scan for issues'
  }
}

// Detect user intent
function detectIntent(text) {
  if (text.includes('create') || text.includes('add') || text.includes('make') || text.includes('new')) return 'create'
  if (text.includes('status') || text.includes('move') || text.includes('change')) return 'status'
  if (text.includes('claim') || text.includes('assign') || text.includes('take')) return 'claim'
  if (text.includes('scan') || text.includes('find bugs') || text.includes('check') || text.includes('search')) return 'scan'
  return null
}

// Create ticket
async function handleCreateTicket(prompt) {
  try {
    const title = extractTicketTitle(prompt)
    const description = extractTicketDescription(prompt)
    
    const { id, project_id, ...meta } = await createTicket(route.params.projectId, title, description, authStore.token, apiKey.value)
    
    return `Created ticket #${id}: "${title}"\nDescription: ${description}\nProject: ${meta.projectName || 'Unknown'}`
  } catch (error) {
    throw error
  }
}

// Change ticket status
async function handleChangeStatus(prompt) {
  const status = getStatusFromPrompt(prompt)
  if (!status) throw new Error('Invalid status. Use: backlog, in_progress, review, or done')
  
  try {
    const result = await changeTicketStatus(route.params.projectId, status, authStore.token, apiKey.value)
    return `Moved ticket to ${status} status\n${result.newStatus}`
  } catch (error) {
    throw error
  }
}

// Claim ticket
async function handleClaim(prompt) {
  try {
    const match = prompt.match(/ticket(s)?\s*[:\s]+(#{1,2}\s)?(\d+)/i)
    const ticketId = match ? match[3] : null
    
    if (!ticketId) throw new Error('Ticket required')
    
    const result = await claimTicket(ticketId, authStore.token, apiKey.value)
    return `Claimed by ${result.claimedBy}\nTicket now in progress`
  } catch (error) {
    throw error
  }
}

// Scan for issues
async function handleScan(prompt) {
  try {
    // In production, this would integrate with a code scanning service
    addMessage('system', 'Scanning project repository...')
    
    // Simulated scan (replace with actual scan service)
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    return `Scan complete\nFound 0 critical issues\n4 medium priority items\nSee tickets view`
  } catch (error) {
    throw error
  }
}

// Extract title from natural language
function extractTicketTitle(text) {
  const match = text.match(/^(add|create|make|new)\s+([a-zA-Z0-9\s\-()]+?)(?:\s+as|$)/i)
  const match2 = text.match(/create\s+|new\s+|make\s+a\s+(bug|issue|ticket|feature)\s+/i)
  return match2 ? match2[1] : 'New ticket'
}

// Extract description from natural language
function extractTicketDescription(text) {
  return text
}

// Get status from prompt
function getStatusFromPrompt(text) {
  const statuses = ['backlog', 'in_progress', 'review', 'done']
  return statuses.find(s => text.includes(s))
}

// Get recent daily usage from history
async function getRecentDailyUsage() {
  try {
    const { totalCost, daily } = await getAgentHistory(selectedAgentId.value, authStore.token, apiKey.value)
    if (daily && daily.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      const todayEntry = daily.find(d => d.date === today)
      
      if (todayEntry) {
        return {
          used: todayEntry.count,
          limit: 100,
          resetAt: todayEntry.date
        }
      }
    }
    return { used: 0, limit: 100 }
  } catch (error) {
    console.error('Failed to get daily usage:', error)
    return null
  }
}
</script>

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

.stat-divider {
  color: #9ca3af;
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
  animation: fadeIn 0.3s ease;
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

.message.system .message-content,
.message.agent .message-content {
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
.scan-btn,
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

.scan-btn {
  background: #6366f1;
  color: white;
}

.scan-btn:hover:not(:disabled) {
  background: #4f46e5;
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

.usage-warning p {
  margin: 0;
}
</style>
