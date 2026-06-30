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
    emit('transition', 'assigned')
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
    emit('transition', 'planning', { reason: rejectReason.value.trim() })
  } catch (e) {
    error.value = e.message || 'Rejection failed'
  } finally {
    rejecting.value = false
  }
}
</script>

<template>
  <div class="phase-plan-approved">
    <h2>Plan Approved</h2>
    <div class="status-badge approved">
      Planning Complete
    </div>

    <p class="phase-description">
      The planning documents are ready for review. Approve to assign an agent, or reject to return to planning.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="plan-preview">
      <h3>Plan Details</h3>
      <div class="plan-content">
        <p>Template: <strong>{{ phaseData.currentPhase }}</strong></p>
        <p>Status: <span class="badge">completed</span></p>
        <p>Review the planning documents above. Make a decision below.</p>
      </div>
    </div>

    <div class="reject-section" v-if="phaseData.allowedTransitions?.includes('planning')">
      <label for="rejectReason">Rejection Reason</label>
      <textarea
        id="rejectReason"
        v-model="rejectReason"
        rows="3"
        placeholder="Why are you rejecting this plan?"
      ></textarea>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back</button>
      <button
        v-if="phaseData.allowedTransitions?.includes('planning')"
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
        {{ approving ? 'Approving...' : 'Approve & Assign' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-plan-approved {
  max-width: 600px;
}

.phase-plan-approved h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.status-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 16px;
}

.status-badge.approved {
  background: #d1fae5;
  color: #065f46;
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

.plan-preview {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 24px;
}

.plan-preview h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #374151;
}

.plan-content {
  line-height: 1.8;
}

.plan-content .badge {
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
