<script setup>
import { ref } from 'vue'

const props = defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const rejecting = ref(false)
const approving = ref(false)
const rejectReason = ref('')
const error = ref('')

async function handleApprove() {
  error.value = ''
  approving.value = true
  try {
    emit('transition', 'done')
  } catch (e) {
    error.value = e.message || 'Approval failed'
  } finally {
    approving.value = false
  }
}

async function handleReject() {
  error.value = ''
  if (!rejectReason.value.trim()) {
    error.value = 'Please provide a reason for rejection'
    return
  }
  rejecting.value = true
  try {
    emit('transition', 'in_progress', { reason: rejectReason.value.trim() })
  } catch (e) {
    error.value = e.message || 'Rejection failed'
  } finally {
    rejecting.value = false
  }
}
</script>

<template>
  <div class="phase-human-approval">
    <h2>Human Approval</h2>
    <p class="phase-description">
      Review the final changes before approving.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="summary-section">
      <h3>Summary of Changes</h3>
      <div class="summary-content">
        <div class="summary-row">
          <span class="summary-label">Ticket:</span>
          <span class="summary-value">{{ ticketId }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Files Changed:</span>
          <span class="summary-value">0 (bp-34/35)</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Status:</span>
          <span class="summary-value">
            <span class="badge">ready for approval</span>
          </span>
        </div>
      </div>
    </div>

    <div class="reject-section" v-if="phaseData.allowedTransitions?.includes('in_progress')">
      <label for="rejectReason">Rejection Reason</label>
      <textarea
        id="rejectReason"
        v-model="rejectReason"
        rows="3"
        placeholder="Why are you rejecting this?"
      ></textarea>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back</button>
      <button
        v-if="phaseData.allowedTransitions?.includes('in_progress')"
        @click="handleReject"
        :disabled="rejecting"
        class="btn-danger"
      >
        {{ rejecting ? 'Rejecting...' : 'Reject' }}
      </button>
      <button
        @click="handleApprove"
        :disabled="approving"
        class="btn-primary"
      >
        {{ approving ? 'Approving...' : 'Approve & Mark Done' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-human-approval {
  max-width: 600px;
}

.phase-human-approval h2 {
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

.summary-section {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 24px;
}

.summary-section h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #374151;
}

.summary-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.summary-label {
  font-weight: 500;
  color: #6b7280;
}

.summary-value {
  color: #374151;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  background: #d1fae5;
  color: #065f46;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.reject-section {
  margin-bottom: 24px;
}

.reject-section label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.reject-section textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
}

.reject-section textarea:focus {
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
