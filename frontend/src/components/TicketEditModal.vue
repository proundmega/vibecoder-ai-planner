<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { fetchProjectUsers, updateTicket } from '@/api/tickets'

const props = defineProps({
  ticket: { type: Object, required: true },
  projectId: { type: String, required: true }
})

const emit = defineEmits(['close', 'saved'])
const authStore = useAuthStore()

const title = ref('')
const description = ref('')
const priority = ref('medium')
const assigneeId = ref(null)
const assignees = ref([])
const saving = ref(false)
const error = ref(null)

const canEdit = computed(() => {
  if (!authStore.user.value) return false
  if (authStore.canUpdateTicket()) return true
  if (authStore.hasRole('user') && props.ticket?.owner_id === authStore.user.value.id) return true
  return false
})

onMounted(async () => {
  title.value = props.ticket.title || ''
  description.value = props.ticket.description || ''
  priority.value = props.ticket.priority || 'medium'
  assigneeId.value = props.ticket.assignee_id || null
  
  try {
    const response = await fetchProjectUsers(props.projectId)
    assignees.value = response || []
  } catch (err) {
    console.error('Failed to load assignees:', err)
  }
})

async function handleSave() {
  if (!title.value.trim()) {
    error.value = 'Title is required'
    return
  }
  
  saving.value = true
  error.value = null
  
  try {
    const updates = {
      title: title.value.trim(),
      description: description.value.trim() || null,
      priority: priority.value
    }
    
    if (assigneeId.value) {
      updates.assigneeId = assigneeId.value
    }
    
    await updateTicket(props.ticket.id, updates)
    emit('saved', updates)
    emit('close')
  } catch (err) {
    error.value = err.message || 'Failed to update ticket'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>Edit Ticket</h2>
      
      <form @submit.prevent="handleSave">
        <label>Title</label>
        <input v-model="title" type="text" placeholder="Ticket title" required />
        
        <label>Description</label>
        <textarea v-model="description" placeholder="Ticket description" rows="4"></textarea>
        
        <label>Priority</label>
        <select v-model="priority">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        
        <label>Assignee</label>
        <select v-model="assigneeId">
          <option :value="null">Unassigned</option>
          <option v-for="user in assignees" :key="user.id" :value="user.id">
            {{ user.name || user.email }}
          </option>
        </select>
        
        <p v-if="error" class="error">{{ error }}</p>
        
        <div class="modal-actions">
          <button type="button" @click="$emit('close')" class="btn-cancel">Cancel</button>
          <button type="submit" :disabled="saving || !canEdit" class="btn-submit">
            {{ saving ? 'Saving...' : 'Save Changes' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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
  width: 560px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
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
.modal textarea,
.modal select {
  width: 100%;
  padding: 10px;
  margin-bottom: 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.modal textarea {
  resize: vertical;
}

.error {
  color: #ef4444;
  font-size: 13px;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: #fee2e2;
  border-radius: 6px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.btn-cancel {
  padding: 10px 20px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-submit {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
}

.btn-submit:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}
</style>
