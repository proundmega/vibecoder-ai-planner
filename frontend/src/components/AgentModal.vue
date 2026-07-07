<script setup>
import { ref } from 'vue'

defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'created'])

const name = ref('')
const error = ref('')
const loading = ref(false)

function close() {
  emit('update:show', false)
  name.value = ''
  error.value = ''
}

async function submit() {
  if (!name.value.trim()) {
    error.value = 'Name is required'
    return
  }
  if (name.value.trim().length > 100) {
    error.value = 'Name must be 100 characters or less'
    return
  }
  loading.value = true
  error.value = ''
  try {
    emit('created', name.value.trim())
    close()
  } catch (err) {
    error.value = err.message || 'Failed to create agent'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="close">
      <div class="modal">
        <h2>Create Agent</h2>
        <form @submit.prevent="submit">
          <div class="form-group">
            <label for="agent-name">Agent Name</label>
            <input
              id="agent-name"
              v-model="name"
              type="text"
              placeholder="e.g., Code Reviewer"
              :disabled="loading"
              autofocus
            />
          </div>
          <div v-if="error" class="error">{{ error }}</div>
          <div class="modal-actions">
            <button type="submit" class="btn-submit" :disabled="loading || !name.trim()">
              {{ loading ? 'Creating...' : 'Create' }}
            </button>
            <button type="button" class="btn-cancel" @click="close" :disabled="loading">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 100%;
  max-width: 400px;
}

.modal h2 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #1f2937;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: #ef4444;
  margin-bottom: 12px;
  font-size: 14px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-submit {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-submit:hover:not(:disabled) {
  background: #2563eb;
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-cancel:hover:not(:disabled) {
  background: #f9fafb;
}

.btn-cancel:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
