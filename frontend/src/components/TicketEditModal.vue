<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { fetchProjectUsers, updateTicket } from '@/api/tickets'
import VModal from '@/components/VModal.vue'
import VButton from '@/components/VButton.vue'
import VInput from '@/components/VInput.vue'

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
  <VModal v-model="$attrs['onUpdate:modelValue'] ?? true" title="Edit Ticket" size="large" @close="emit('close')">
    <form @submit.prevent="handleSave">
      <VInput v-model="title" label="Title" placeholder="Ticket title" :error="error" required />
      
      <VInput v-model="description" label="Description" placeholder="Ticket description" type="textarea" />
      
      <VInput v-model="priority" label="Priority" type="select">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="urgent">Urgent</option>
      </VInput>
      
      <VInput v-model="assigneeId" label="Assignee" type="select">
        <option :value="null">Unassigned</option>
        <option v-for="user in assignees" :key="user.id" :value="user.id">
          {{ user.name || user.email }}
        </option>
      </VInput>
      
      <div class="modal-actions">
        <VButton variant="secondary" @click="emit('close')">Cancel</VButton>
        <VButton type="submit" variant="primary" :loading="saving" :disabled="!canEdit">
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </VButton>
      </div>
    </form>
  </VModal>
</template>

<style scoped>
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}
</style>
