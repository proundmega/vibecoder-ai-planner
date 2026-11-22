<template>
  <div v-if="question" class="ticket-question-card" data-testid="ticket-question-card">
    <div class="card-header">
      <h3>Harness question</h3>
      <span class="question-kind">{{ question.kind }}</span>
    </div>
    <p class="question-prompt">{{ question.prompt }}</p>
    <div v-if="isPermission" class="quick-answers">
      <button type="button" :disabled="submitting" @click="submitWith('allow')">Allow once</button>
      <button type="button" :disabled="submitting" @click="submitWith('always')">Always allow</button>
      <button type="button" class="danger" :disabled="submitting" @click="submitWith('reject')">Reject</button>
    </div>
    <div v-else-if="isDoomLoop" class="quick-answers">
      <button type="button" :disabled="submitting" @click="submitWith('continue')">Continue</button>
      <button type="button" class="danger" :disabled="submitting" @click="submitWith('abort')">Abort run</button>
    </div>
    <form v-else class="card-answer" @submit.prevent="submit">
      <textarea
        v-model="answer"
        rows="2"
        placeholder="Answer the harness…"
        :disabled="submitting"
      />
      <div class="card-actions">
        <button type="submit" :disabled="submitting || !answer.trim()">
          {{ submitting ? 'Sending…' : 'Answer' }}
        </button>
        <span v-if="error" class="card-error">{{ error }}</span>
      </div>
    </form>
    <span v-if="error && (isPermission || isDoomLoop)" class="card-error">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { answerQuestion, listTicketQuestions, type TicketQuestion } from '@/api/questions'

const props = defineProps<{ ticketId: number | string }>()
const emit = defineEmits<{ answered: [question: TicketQuestion] }>()

const question = ref<TicketQuestion | null>(null)
const answer = ref('')
const submitting = ref(false)
const error = ref('')

const isPermission = computed(() => question.value?.kind === 'permission')
const isDoomLoop = computed(() => question.value?.kind === 'doom_loop')

async function load(): Promise<void> {
  try {
    const rows = await listTicketQuestions(props.ticketId, { status: 'pending', limit: 1 })
    question.value = rows[0] || null
  } catch {
    question.value = null
  }
}

async function submitWith(value: string): Promise<void> {
  answer.value = value
  await submit()
}

async function submit(): Promise<void> {
  const current = question.value
  const text = answer.value.trim()
  if (!current || !text) return
  submitting.value = true
  error.value = ''
  try {
    await answerQuestion(current.run_id, current.id, text)
    emit('answered', current)
    question.value = null
    answer.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not send the answer'
  } finally {
    submitting.value = false
  }
}

onMounted(load)
watch(() => props.ticketId, load)
</script>

<style scoped>
.ticket-question-card {
  margin: 16px 0;
  padding: 16px;
  border: 1px solid #fbbf24;
  border-left: 4px solid #f59e0b;
  border-radius: 8px;
  background: #fffbeb;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-header h3 {
  margin: 0;
  font-size: 15px;
}

.question-kind {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #92400e;
}

.question-prompt {
  margin: 8px 0 12px;
  white-space: pre-wrap;
}

.card-answer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-answers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-answers button {
  padding: 6px 14px;
  border: 1px solid #b45309;
  border-radius: 6px;
  background: #fff;
  color: #92400e;
  cursor: pointer;
}

.quick-answers button.danger {
  border-color: #b91c1c;
  color: #b91c1c;
}

.quick-answers button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.card-answer textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #d6b25e;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-actions button {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  background: #b45309;
  color: #fff;
  cursor: pointer;
}

.card-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.card-error {
  color: #b91c1c;
  font-size: 13px;
}
</style>
