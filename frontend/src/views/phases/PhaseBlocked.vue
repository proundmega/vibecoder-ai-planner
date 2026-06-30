<script setup>
import { ref } from 'vue'
import { post } from '@/api/client'

const props = defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const replyText = ref('')
const sending = ref(false)
const unblocking = ref(false)
const error = ref('')

async function sendReply() {
  if (!replyText.value.trim()) return
  sending.value = true
  error.value = ''
  try {
    await post(`/api/v1/tickets/${props.ticketId}/feedback`, {
      content: replyText.value.trim(),
    })
    replyText.value = ''
  } catch (e) {
    error.value = e.message || 'Failed to send reply'
  } finally {
    sending.value = false
  }
}

async function handleUnblock() {
  error.value = ''
  unblocking.value = true
  try {
    emit('transition', 'in_progress')
  } catch (e) {
    error.value = e.message || 'Failed to unblock'
  } finally {
    unblocking.value = false
  }
}
</script>

<template>
  <div class="phase-blocked">
    <h2>Blocked</h2>
    <div class="status-badge blocked">
      Waiting for human response
    </div>

    <p class="phase-description">
      The agent is blocked and needs your input to proceed.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="agent-question">
      <h3>Agent's Question</h3>
      <div class="question-content">
        <p>The agent has paused and is waiting for your response. Reply below to unblock.</p>
      </div>
    </div>

    <div class="reply-form">
      <label for="reply">Your Reply</label>
      <textarea
        id="reply"
        v-model="replyText"
        rows="4"
        placeholder="Answer the agent's question or provide guidance..."
      ></textarea>
      <div class="reply-actions">
        <button @click="sendReply" :disabled="sending || !replyText.trim()" class="btn-send">
          {{ sending ? 'Sending...' : 'Send Reply' }}
        </button>
        <button @click="handleUnblock" :disabled="unblocking" class="btn-unblock">
          {{ unblocking ? 'Unblocking...' : 'Mark as Unblocked' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phase-blocked {
  max-width: 600px;
}

.phase-blocked h2 {
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
  background: #fef3c7;
  color: #92400e;
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

.agent-question {
  padding: 16px;
  background: #fef3c7;
  border-radius: 8px;
  border: 1px solid #fde68a;
  margin-bottom: 24px;
}

.agent-question h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #92400e;
}

.question-content p {
  margin: 0;
  color: #78350f;
  font-size: 14px;
}

.reply-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reply-form label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.reply-form textarea {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
}

.reply-form textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.reply-actions {
  display: flex;
  gap: 12px;
}

.btn-send {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-send:hover:not(:disabled) {
  background: #2563eb;
}

.btn-send:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-unblock {
  padding: 10px 20px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-unblock:hover:not(:disabled) {
  background: #059669;
}

.btn-unblock:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}
</style>
