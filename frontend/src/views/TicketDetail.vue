<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchTicket, updateTicket, addComment, fetchComments } from '@/api/tickets'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const ticket = ref(null)
const loading = ref(true)
const error = ref(null)
const newComment = ref('')
const comments = ref([])

const ticketId = route.params.ticketId

onMounted(async () => {
  try {
    ticket.value = await fetchTicket(ticketId)
    if (!ticket.value) {
      error.value = 'Ticket not found'
    } else {
      comments.value = await fetchComments(ticketId)
    }
  } catch (e) {
    console.error('Failed to load ticket:', e)
    error.value = e.message || 'Failed to load ticket'
  } finally {
    loading.value = false
  }
})

async function changeStatus(newStatus) {
  if (!ticket.value) return
  try {
    await updateTicket(ticket.value.id, { status: newStatus })
    ticket.value.status = newStatus
  } catch (err) {
    console.error('Failed to update status:', err)
    error.value = 'Failed to update status: ' + err.message
  }
}

async function addCommentText() {
  if (!newComment.value.trim() || !ticket.value) return
  try {
    const comment = await addComment(ticket.value.id, newComment.value.trim())
    if (comment) {
      comments.value.push(comment)
    }
  } catch (err) {
    console.error('Failed to add comment:', err)
    error.value = 'Failed to add comment'
  }
  newComment.value = ''
}

function canUpdate() {
  const user = authStore.user.value
  return user && (user.role === 'ADMIN' || user.role === 'MEMBER' || user.role === 'admin' || user.role === 'member')
}
</script>

<template>
  <div class="ticket-detail">
    <h1>Ticket #{{ ticketId }}</h1>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="router.go(-1)">Go Back</button>
    </div>

    <div v-else>
      <div class="ticket-header">
        <span class="badge status" :class="ticket?.status">{{ ticket?.status }}</span>
        <span class="title">{{ ticket?.title }}</span>
      </div>

      <div class="meta">
        <span>Priority: <strong>{{ ticket?.priority || 'medium' }}</strong></span>
      </div>

      <div v-if="ticket?.description" class="description">
        <h3>Description</h3>
        <p>{{ ticket.description }}</p>
      </div>

      <div class="actions">
        <button v-if="canUpdate()" @click="changeStatus('backlog')" :disabled="ticket?.status === 'backlog'">Move to Backlog</button>
        <button v-if="canUpdate() && ticket?.status === 'backlog'" @click="changeStatus('in_progress')">Start Work</button>
        <button v-if="canUpdate() && ticket?.status === 'in_progress'" @click="changeStatus('review')">Submit Review</button>
        <button v-if="canUpdate() && ticket?.status === 'review'" @click="changeStatus('done')">Mark as Done</button>
        <button @click="router.back()" class="back">Back</button>
      </div>

      <div class="comments">
        <h3>Comments</h3>
        <div v-for="comment in comments" :key="comment.id" class="comment">
          <div class="comment-header">
            <span class="comment-user">{{ comment.user_email || 'Unknown' }}</span>
            <span class="comment-time">{{ new Date(comment.created_at).toLocaleString() }}</span>
          </div>
          <div class="comment-text">{{ comment.content }}</div>
        </div>
        <div v-if="canUpdate()" class="comment-input">
          <input v-model="newComment" placeholder="Add a comment..." @keyup.enter="addCommentText" />
          <button @click="addCommentText">Add</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ticket-detail {
  max-width: 1200px;
  margin: 20px auto;
  padding: 0 20px;
}

h1 {
  margin-bottom: 20px;
}

.ticket-header {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
}

.ticket-header .status {
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  background: #e0e0e0;
}

.ticket-header .status.backlog { background: #f59e0b; color: white; }
.ticket-header .status.in_progress { background: #3b82f6; color: white; }
.ticket-header .status.review { background: #8b5cf6; color: white; }
.ticket-header .status.done { background: #10b981; color: white; }

.ticket-header .title {
  font-size: 28px;
  margin: 0;
}

.meta {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  color: #666;
}

.description h3 {
  margin-bottom: 10px;
  color: #333;
}

.description p {
  line-height: 1.6;
  white-space: pre-wrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 20px 0;
}

.actions button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background: #3b82f6;
  color: white;
  cursor: pointer;
  font-size: 14px;
}

.actions button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.actions .back {
  background: #6b7280;
}

.comments {
  margin-top: 40px;
  border-top: 1px solid #e5e7eb;
  padding-top: 20px;
}

.comment {
  margin-bottom: 20px;
  padding: 15px;
  background: #f9fafb;
  border-radius: 8px;
}

.comment-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  color: #6b7280;
}

.comment-user {
  font-weight: bold;
  color: #374151;
}

.comment-text {
  color: #374151;
  line-height: 1.5;
  white-space: pre-wrap;
}

.comment-input {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.comment-input input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}

.comment-input button {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.loading, .error {
  padding: 40px;
  text-align: center;
}

.error {
  color: #ef4444;
}
</style>
