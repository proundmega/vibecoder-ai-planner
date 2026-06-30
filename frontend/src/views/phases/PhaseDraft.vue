<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const title = ref('')
const description = ref('')
const priority = ref('medium')
const error = ref('')
const saving = ref(false)

const priorities = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

async function handleSubmit() {
  error.value = ''

  if (!title.value.trim()) {
    error.value = 'Title is required'
    return
  }
  if (!description.value.trim() || description.value.trim().length < 10) {
    error.value = 'Description must be at least 10 characters'
    return
  }

  saving.value = true
  try {
    emit('transition', 'planning', {
      title: title.value.trim(),
      description: description.value.trim(),
      priority: priority.value,
    })
  } catch (e) {
    error.value = e.message || 'Failed to save draft'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="phase-draft">
    <h2>Draft Phase</h2>
    <p class="phase-description">
      Fill in the ticket details to start the planning process.
    </p>

    <form @submit.prevent="handleSubmit" class="draft-form">
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div class="form-group">
        <label for="title">Title *</label>
        <input
          id="title"
          v-model="title"
          type="text"
          placeholder="Brief title for the ticket"
          :disabled="saving"
        />
      </div>

      <div class="form-group">
        <label for="description">Description *</label>
        <textarea
          id="description"
          v-model="description"
          rows="6"
          placeholder="Detailed description of what needs to be done..."
          :disabled="saving"
        ></textarea>
        <span class="char-count">{{ description.length }} characters (min 10)</span>
      </div>

      <div class="form-group">
        <label for="priority">Priority</label>
        <select id="priority" v-model="priority" :disabled="saving">
          <option v-for="p in priorities" :key="p.value" :value="p.value">
            {{ p.label }}
          </option>
        </select>
      </div>

      <div class="form-actions">
        <button type="button" @click="emit('back')" class="btn-secondary">
          Cancel
        </button>
        <button type="submit" :disabled="saving" class="btn-primary">
          {{ saving ? 'Saving...' : 'Save & Move to Planning' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.phase-draft {
  max-width: 600px;
}

.phase-draft h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.draft-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.error-banner {
  padding: 12px 16px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  font-size: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.form-group input,
.form-group textarea,
.form-group select {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group textarea {
  resize: vertical;
  min-height: 100px;
}

.char-count {
  font-size: 12px;
  color: #9ca3af;
  text-align: right;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 8px;
}

.btn-primary {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary:hover {
  background: #f9fafb;
}
</style>
