<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getComments, postComment } from '../api/review'
import { useReviewDataSource } from '../composables/useReviewDataSource'
import { post } from '../api/client'
import DiffViewer from '../components/DiffViewer.vue'

const route = useRoute()
const router = useRouter()
const ticketId = route.params.ticketId
const projectId = route.params.projectId

const { source, files, loading, error, load } = useReviewDataSource(ticketId)

const comments = ref([])
const approveLoading = ref(false)
const changesLoading = ref(false)
const selectedLine = ref(null)
const newComment = ref('')

async function loadComments() {
  try {
    comments.value = await getComments(ticketId)
  } catch {
    // ignore
  }
}

function onLineClick(file, line) {
  selectedLine.value = { file, line }
  newComment.value = ''
}

async function submitComment() {
  if (!newComment.value.trim() || !selectedLine.value) return
  try {
    await postComment(ticketId, {
      content: newComment.value,
      file_path: selectedLine.value.file,
      line_number: selectedLine.value.line,
    })
    newComment.value = ''
    selectedLine.value = null
    await loadComments()
  } catch (e) {
    alert(e.message)
  }
}

async function approve() {
  approveLoading.value = true
  try {
    await post(`/api/v1/tickets/${ticketId}/phases/transition`, {
      toPhase: 'human_approval',
      metadata: { action: 'approved', source: source.value },
    })
    router.push(`/projects/${projectId}/tickets/${ticketId}`)
  } catch (e) {
    alert(e.message)
  } finally {
    approveLoading.value = false
  }
}

async function requestChanges() {
  const reason = prompt('Describe what changes are needed:')
  if (!reason) return
  changesLoading.value = true
  try {
    await post(`/api/v1/tickets/${ticketId}/phases/transition`, {
      toPhase: 'in_progress',
      metadata: { action: 'changes_requested', reason },
    })
    router.push(`/projects/${projectId}/tickets/${ticketId}`)
  } catch (e) {
    alert(e.message)
  } finally {
    changesLoading.value = false
  }
}

onMounted(() => {
  load()
  loadComments()
})
</script>

<template>
  <div class="code-review">
    <div v-if="loading" class="loading">Loading diff...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="!source || files.length === 0" class="empty">No files to review</div>
    <template v-else>
      <div class="review-header">
        <h2>Code Review · {{ files.length }} file{{ files.length > 1 ? 's' : '' }}</h2>
        <div class="review-actions">
          <button @click="requestChanges" :disabled="changesLoading" class="btn-changes">
            {{ changesLoading ? 'Submitting...' : '← Request Changes' }}
          </button>
          <button @click="approve" :disabled="approveLoading" class="btn-approve">
            {{ approveLoading ? 'Processing...' : '✓ Approve' }}
          </button>
        </div>
      </div>

      <div class="source-indicator">
        Source: <span class="source-label">{{ source === 'github' ? 'GitHub PR' : 'Local changes' }}</span>
      </div>

      <DiffViewer :files="files" :comments="comments" @line-click="onLineClick" />

      <div v-if="selectedLine" class="comment-form">
        <div class="comment-form-header">
          Comment on <code>{{ selectedLine.file }}:{{ selectedLine.line }}</code>
        </div>
        <textarea v-model="newComment" rows="3" class="comment-input" placeholder="Write a comment..."></textarea>
        <div class="comment-actions">
          <button @click="submitComment" :disabled="!newComment.trim()" class="btn-submit">Submit</button>
          <button @click="selectedLine = null" class="btn-cancel">Cancel</button>
        </div>
      </div>
    </template>

    <router-link :to="`/projects/${projectId}/tickets/${ticketId}`" class="back-link">← Back to Ticket</router-link>
  </div>
</template>

<style scoped>
.code-review {
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
}

.loading, .error, .empty {
  padding: 60px 20px;
  text-align: center;
}

.loading {
  color: #6b7280;
}

.error {
  color: #ef4444;
}

.empty {
  color: #9ca3af;
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.review-header h2 {
  margin: 0;
  font-size: 18px;
  color: #1f2937;
}

.review-actions {
  display: flex;
  gap: 12px;
}

.btn-changes, .btn-approve {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid;
}

.btn-changes {
  background: #fff7ed;
  border-color: #fdba74;
  color: #c2410c;
}

.btn-changes:hover:not(:disabled) {
  background: #ffedd5;
}

.btn-approve {
  background: #f0fdf4;
  border-color: #86efac;
  color: #15803d;
}

.btn-approve:hover:not(:disabled) {
  background: #dcfce7;
}

.btn-changes:disabled, .btn-approve:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.source-indicator {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 1rem;
}

.source-label {
  font-weight: 600;
  color: #374151;
}

.comment-form {
  margin-top: 1rem;
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.comment-form-header {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.comment-form-header code {
  background: #e5e7eb;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.comment-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
}

.comment-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.comment-actions {
  display: flex;
  gap: 8px;
  margin-top: 0.5rem;
}

.btn-submit {
  padding: 6px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-submit:hover:not(:disabled) {
  background: #2563eb;
}

.btn-cancel {
  padding: 6px 16px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.btn-cancel:hover {
  background: #f3f4f6;
}

.back-link {
  display: inline-block;
  margin-top: 1rem;
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}

.back-link:hover {
  text-decoration: underline;
}
</style>
