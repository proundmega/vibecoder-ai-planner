<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchProjects } from '@/api/projects'
import { fetchTickets, updateTicket, createTicket } from '@/api/tickets'

const route = useRoute()
const router = useRouter()

const authStore = useAuthStore()
const projects = ref([])
const tickets = ref([])
const loading = ref(true)
const error = ref(null)
const selectedProjectId = ref(null)
const showCreateTicket = ref(false)
const newTicketTitle = ref('')
const newTicketDesc = ref('')
const creating = ref(false)
const creationError = ref(null)

watch(showCreateTicket, (value) => {
  if (!value) {
    newTicketTitle.value = ''
    newTicketDesc.value = ''
    creationError.value = null
  }
})

const statusColumns = [
  { id: 'backlog', label: 'Backlog', class: 'status-col backlog' },
  { id: 'in_progress', label: 'In Progress', class: 'status-col in_progress' },
  { id: 'review', label: 'Review', class: 'status-col review' },
  { id: 'done', label: 'Done', class: 'status-col done' }
]

function columnTickets(status) {
  return tickets.value.filter(t => t.status === status)
}

const canCreate = computed(() => {
  return authStore.canCreateTicket()
})

onMounted(async () => {
  try {
    projects.value = await fetchProjects()
  } catch (err) {
    console.error('Failed to load projects:', err)
    projects.value = []
  }

  if (projects.value && projects.value.length > 0) {
    selectedProjectId.value = projects.value[0].id
    await loadTickets(selectedProjectId.value)
  } else {
    error.value = 'No projects available'
    loading.value = false
  }
})

async function loadTickets(projectId) {
  try {
    tickets.value = await fetchTickets(projectId)
  } catch (err) {
    console.error('Failed to load tickets:', err)
    error.value = 'Failed to load tickets'
    tickets.value = []
  } finally {
    loading.value = false
  }
}

async function handleDrop(ticketId, newStatus) {
  const ticket = tickets.value.find(t => t.id === ticketId)
  if (!ticket || !canUpdateTicket(ticket)) return

  try {
    await updateTicket(ticket.id, { status: newStatus })
    ticket.status = newStatus
  } catch (err) {
    console.error('Failed to update ticket status:', err)
  }
}

function canUpdateTicket(ticket) {
  if (!authStore.user.value) return false
  if (authStore.canUpdateTicket()) return true
  if (ticket.assignee_id && ticket.assignee_id === authStore.user.value.id) return true
  return false
}

async function handleCreateTicket() {
  if (!newTicketTitle.value.trim() || !selectedProjectId.value) return
  creating.value = true
  creationError.value = null
  try {
    await createTicket(selectedProjectId.value, newTicketTitle.value.trim(), newTicketDesc.value.trim())
    showCreateTicket.value = false
    newTicketTitle.value = ''
    newTicketDesc.value = ''
    await loadTickets(selectedProjectId.value)
  } catch (err) {
    console.error('Failed to create ticket:', err)
    creationError.value = 'Failed to create ticket. Please try again.'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="kanban-board">
    <header class="board-header">
      <h1>My Board</h1>

      <div class="board-controls">
        <select v-model="selectedProjectId" class="project-select" :disabled="projects.length === 0" @change="loadTickets(selectedProjectId)">
          <option v-if="projects.length === 0" value="">No projects</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>

        <button v-if="canCreate" @click="showCreateTicket = true" class="btn-primary" :disabled="!selectedProjectId">
          + New Ticket
        </button>

        <div v-if="showCreateTicket" class="modal-overlay" @click.self="showCreateTicket = false">
          <div class="modal">
            <h2>Create New Ticket</h2>
            <form @submit.prevent="handleCreateTicket">
              <label>Title</label>
              <input v-model="newTicketTitle" type="text" placeholder="Enter ticket title" required />
              <label>Description</label>
              <textarea v-model="newTicketDesc" placeholder="Optional description" rows="3"></textarea>
              <p v-if="creationError" class="creation-error">{{ creationError }}</p>
              <div class="modal-actions">
                <button type="button" @click="showCreateTicket = false" class="btn-cancel">Cancel</button>
                <button type="submit" :disabled="creating" class="btn-submit">{{ creating ? 'Creating...' : 'Create' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </header>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="loadTickets(selectedProjectId || projects[0]?.id)">Retry</button>
    </div>

    <div v-else-if="tickets.length === 0" class="empty">
      <p>No tickets yet. Create one to get started!</p>
    </div>

    <div v-else class="board-container">
      <div v-for="columnDef in statusColumns" :key="columnDef.id"
           class="status-column"
           :class="columnDef.class"
           @drop="($event) => $event.dataTransfer && handleDrop($event.dataTransfer.getData('ticketId'), columnDef.id)"
           @dragover.prevent
      >
        <div class="column-header">
          <span class="status-label">{{ columnDef.label }}</span>
          <span class="ticket-count">{{ columnTickets(columnDef.id).length }}</span>
        </div>

        <div class="status-tickets">
          <div
            v-for="ticket in columnTickets(columnDef.id)"
            :key="ticket.id"
            class="ticket-card"
            draggable="true"
            @dragstart="($event) => $event.dataTransfer?.setData('ticketId', ticket.id)"
            @click="router.push(`/projects/${route.params.id}/tickets/${ticket.id}`)"
            style="cursor: pointer;"
          >
            <div class="ticket-content">
              <div class="ticket-title">{{ ticket.title || 'Untitled' }}</div>
              <div v-if="ticket.description" class="ticket-description">{{ ticket.description }}</div>
              <div class="ticket-meta">
                <span v-if="ticket.priority" class="priority-badge" :class="ticket.priority">{{ ticket.priority }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-board {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.board-header h1 {
  margin: 0;
  font-size: 24px;
  color: #1f2937;
}

.board-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.project-select {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.loading, .error, .empty {
  padding: 60px;
  text-align: center;
  background: #f9fafb;
  border-radius: 8px;
}

.error {
  color: #ef4444;
}

.board-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  position: relative;
}

.status-column {
  background: #f3f4f6;
  border-radius: 8px;
  padding: 12px;
}

.status-col.backlog { background: #fef3c7; border-left: 4px solid #f59e0b; }
.status-col.in_progress { background: #dbeafe; border-left: 4px solid #3b82f6; }
.status-col.review { background: #ede9fe; border-left: 4px solid #8b5cf6; }
.status-col.done { background: #d1fae5; border-left: 4px solid #10b981; }

.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-label {
  font-weight: 600;
  color: #374151;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ticket-count {
  background: #e5e7eb;
  color: #6b7280;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-tickets {
  min-height: 100px;
}

.ticket-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  cursor: grab;
  transition: box-shadow 0.2s;
}

.ticket-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.ticket-title {
  font-weight: 600;
  color: #1f2937;
  font-size: 14px;
  margin: 0 0 6px 0;
}

.ticket-description {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ticket-meta {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.priority-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.priority-badge.low { background: #dbeafe; color: #1d4ed8; }
.priority-badge.medium { background: #fef3c7; color: #92400e; }
.priority-badge.high { background: #fee2e2; color: #dc2626; }
.priority-badge.critical { background: #fca5a5; color: #991b1b; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: white;
  border-radius: 12px;
  padding: 28px;
  width: 480px;
  max-width: 90vw;
}

.modal h2 {
  margin-bottom: 20px;
  font-size: 20px;
  color: #1f2937;
}

.modal label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.modal input,
.modal textarea {
  width: 100%;
  padding: 10px;
  margin-bottom: 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-submit {
  padding: 8px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-submit:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.creation-error {
  color: #dc2626;
  font-size: 13px;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: #fee2e2;
  border-radius: 6px;
}
</style>
