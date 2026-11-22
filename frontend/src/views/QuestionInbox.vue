<template>
  <div class="question-inbox">
    <div class="inbox-header">
      <div>
        <h1>Question inbox</h1>
        <p class="inbox-subtitle">Harness runs that need a human decision.</p>
      </div>
      <label class="filter">
        Status
        <select v-model="status" data-testid="question-filter" @change="load">
          <option value="pending">Pending</option>
          <option value="answered">Answered</option>
          <option value="">All</option>
        </select>
      </label>
      <label class="filter">
        Project
        <select v-model="projectFilter" data-testid="question-project-filter">
          <option value="">All projects</option>
          <option v-for="project in projectOptions" :key="project.id" :value="String(project.id)">
            {{ project.name }}
          </option>
        </select>
      </label>
    </div>

    <p v-if="loading" class="inbox-status">Loading questions…</p>
    <p v-else-if="error" class="inbox-status inbox-error" data-testid="inbox-error">{{ error }}</p>
    <div v-else-if="visibleQuestions.length === 0" class="inbox-empty" data-testid="inbox-empty">
      <p>No questions right now.</p>
    </div>
    <ul v-else class="question-list">
      <li v-for="question in visibleQuestions" :key="question.id" class="question-card">
        <div class="question-meta">
          <span class="question-kind" :class="question.kind">{{ question.kind }}</span>
          <span v-if="question.project_name">{{ question.project_name }}</span>
          <span v-if="question.ticket_title">· {{ question.ticket_title }}</span>
          <router-link
            class="run-link"
            :to="{ name: 'ProjectHarness', params: { id: question.project_id }, query: { run: question.run_id } }"
          >
            Open run
          </router-link>
        </div>
        <p class="question-prompt">{{ question.prompt }}</p>
        <p v-if="question.status !== 'pending'" class="question-answer">
          <strong>{{ question.status }}:</strong> {{ question.answer || 'No answer recorded.' }}
        </p>
        <div v-else-if="question.kind === 'permission'" class="quick-answers">
          <button type="button" :disabled="submitting[question.id]" @click="submit(question, 'allow')">
            Allow once
          </button>
          <button type="button" :disabled="submitting[question.id]" @click="submit(question, 'always')">
            Always allow
          </button>
          <button
            type="button"
            class="danger"
            :disabled="submitting[question.id]"
            @click="submit(question, 'reject')"
          >
            Reject
          </button>
        </div>
        <div v-else-if="question.kind === 'doom_loop'" class="quick-answers">
          <button type="button" :disabled="submitting[question.id]" @click="submit(question, 'continue')">
            Continue
          </button>
          <button
            type="button"
            class="danger"
            :disabled="submitting[question.id]"
            @click="submit(question, 'abort')"
          >
            Abort run
          </button>
        </div>
        <form v-else class="answer-form" @submit.prevent="submit(question)">
          <textarea
            v-model="drafts[question.id]"
            rows="2"
            placeholder="Answer the harness…"
            :disabled="submitting[question.id]"
          />
          <div class="answer-actions">
            <button type="submit" :disabled="submitting[question.id] || !drafts[question.id]">
              {{ submitting[question.id] ? 'Sending…' : 'Answer' }}
            </button>
          </div>
        </form>
        <span v-if="errors[question.id]" class="answer-error">{{ errors[question.id] }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  answerQuestion,
  listInboxQuestions,
  type QuestionStatus,
  type TicketQuestion,
} from '@/api/questions'

const status = ref<QuestionStatus | ''>('pending')
const questions = ref<TicketQuestion[]>([])
const loading = ref(true)
const error = ref('')
const projectFilter = ref('')
const drafts = reactive<Record<string, string>>({})
const submitting = reactive<Record<string, boolean>>({})
const errors = reactive<Record<string, string>>({})

const projectOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const question of questions.value) {
    const id = String(question.project_id)
    if (!seen.has(id)) {
      seen.set(id, question.project_name || `Project ${id}`)
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
})

const visibleQuestions = computed(() => (
  projectFilter.value
    ? questions.value.filter((question) => String(question.project_id) === projectFilter.value)
    : questions.value
))

async function load(): Promise<void> {
  loading.value = true
  try {
    questions.value = await listInboxQuestions({
      status: status.value || undefined,
      limit: 50,
    })
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load questions'
  } finally {
    loading.value = false
  }
}

async function submit(question: TicketQuestion, value?: string): Promise<void> {
  const key = String(question.id)
  const answer = (value ?? drafts[key] ?? '').trim()
  if (!answer) return
  submitting[key] = true
  errors[key] = ''
  try {
    await answerQuestion(question.run_id, question.id, answer)
    drafts[key] = ''
    await load()
  } catch (e) {
    errors[key] = e instanceof Error ? e.message : 'Could not send the answer'
  } finally {
    submitting[key] = false
  }
}

onMounted(load)
</script>

<style scoped>
.question-inbox {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}

.inbox-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.inbox-header h1 {
  margin: 0 0 4px;
  font-size: 24px;
}

.inbox-subtitle {
  margin: 0;
  color: var(--color-text-secondary, #64748b);
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary, #64748b);
}

.inbox-header {
  gap: 16px;
}

.run-link {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-primary, #2563eb);
  white-space: nowrap;
}

.inbox-status,
.inbox-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-secondary, #64748b);
}

.inbox-error,
.answer-error {
  color: var(--color-danger, #dc2626);
}

.question-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.question-card {
  background: var(--color-bg, #fff);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  padding: 16px;
}

.question-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary, #64748b);
  margin-bottom: 8px;
}

.question-kind {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-bg-secondary, #f1f5f9);
}

.question-kind.doom_loop {
  background: #fef3c7;
  color: #92400e;
}

.question-prompt {
  margin: 0 0 12px;
  white-space: pre-wrap;
}

.question-answer {
  margin: 0;
  font-size: 14px;
}

.answer-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.answer-form textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border, #cbd5e1);
}

.answer-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.quick-answers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-answers button {
  padding: 6px 14px;
  border: 1px solid var(--color-border, #cbd5e1);
  border-radius: 6px;
  background: var(--color-bg, #fff);
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

.answer-actions button {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  background: var(--color-primary, #2563eb);
  color: #fff;
  cursor: pointer;
}

.answer-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.answer-error {
  font-size: 13px;
}
</style>
