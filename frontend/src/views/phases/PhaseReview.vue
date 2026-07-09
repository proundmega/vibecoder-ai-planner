<script setup>
import { ref } from 'vue'

defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const commentText = ref('')
const requestingChanges = ref(false)
const approving = ref(false)
const error = ref('')

async function handleApprove() {
  error.value = ''
  approving.value = true
  try {
    emit('transition', 'human_approval')
  } catch (e) {
    error.value = e.message || 'Approval failed'
  } finally {
    approving.value = false
  }
}

async function handleRequestChanges() {
  error.value = ''
  if (!commentText.value.trim()) {
    error.value = 'Please provide feedback for the changes requested'
    return
  }
  requestingChanges.value = true
  try {
    emit('transition', 'in_progress', { feedback: commentText.value.trim() })
  } catch (e) {
    error.value = e.message || 'Failed to request changes'
  } finally {
    requestingChanges.value = false
  }
}
</script>

<template>
  <div class="phase-review">
    <h2>Review Phase</h2>
    <p class="phase-description">
      Review the changes and approve or request modifications.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Diff viewer placeholder -->
    <div class="diff-placeholder">
      <div class="diff-icon">&#128196;</div>
      <h3>Diff Viewer</h3>
      <p>Diff viewer will appear here (bp-34 — Code Review UI)</p>
      <div class="mock-diff">
        <div class="diff-line added"><span class="diff-sign">+</span> + New code added</div>
        <div class="diff-line removed"><span class="diff-sign">-</span> - Old code removed</div>
        <div class="diff-line unchanged">  Unchanged code</div>
        <div class="diff-line added"><span class="diff-sign">+</span> + More new code</div>
      </div>
    </div>

    <!-- Comments -->
    <div class="comments-section">
      <h3>Review Comments</h3>
      <textarea
        v-model="commentText"
        rows="3"
        placeholder="Add review comments (required when requesting changes)..."
      ></textarea>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back</button>
      <button
        @click="handleRequestChanges"
        :disabled="requestingChanges"
        class="btn-danger"
      >
        {{ requestingChanges ? 'Requesting...' : 'Request Changes' }}
      </button>
      <button
        @click="handleApprove"
        :disabled="approving"
        class="btn-primary"
      >
        {{ approving ? 'Approving...' : 'Approve' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-review {
  max-width: 700px;
}

.phase-review h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.error-banner {
  padding: 12px 16px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  margin-bottom: 20px;
  font-size: 14px;
}

.diff-placeholder {
  padding: 24px;
  background: #f3f4f6;
  border: 2px dashed #d1d5db;
  border-radius: 8px;
  text-align: center;
  margin-bottom: 24px;
}

.diff-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.diff-placeholder h3 {
  margin: 0 0 4px;
  color: #6b7280;
}

.diff-placeholder p {
  margin: 0 0 16px;
  color: #9ca3af;
  font-size: 13px;
}

.mock-diff {
  text-align: left;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
  font-family: monospace;
  font-size: 13px;
}

.diff-line {
  padding: 2px 8px;
  line-height: 1.6;
}

.diff-sign {
  font-weight: bold;
  margin-right: 4px;
}

.diff-line.added {
  background: #d1fae5;
  color: #065f46;
}

.diff-line.removed {
  background: #fee2e2;
  color: #991b1b;
}

.diff-line.unchanged {
  color: #6b7280;
}

.comments-section {
  margin-bottom: 24px;
}

.comments-section h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #374151;
}

.comments-section textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
}

.comments-section textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
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

.btn-danger {
  padding: 10px 20px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-danger:disabled {
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
