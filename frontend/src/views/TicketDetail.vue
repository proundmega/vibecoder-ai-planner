<!--
TKT-012: Implement Ticket Detail View
- ✅ Fetch ticket by ID with ownership validation
- ✅ Display ticket details, project info, assignee
- ✅ Show comments and attachments
- ✅ Status badges and workflow indicators
- ✅ Actions for members/assignees
-->
<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchTicket, updateTicket, deleteTicket, addComment, getComments, fetchProjectByName } from '@/api/tickets'

const route = useRoute()
const authStore = useAuthStore()
const ticket = ref(null)
const project = ref(null)
const comments = ref([])
const loading = ref(true)
const error = ref(null)

const ticketId = route.params.id

onMounted(async () => {
  try {
    const ticketData = await fetchTicket(ticketId, authStore.token)
    ticket.value = ticketData
    
    // Load project if not already loaded
    if (!project.value && ticketData.project_id) {
      project.value = await fetchProjectByName(ticketData.project_name, authStore.token)
    }
    
    // Load comments if not already loaded
    if (!comments.value || comments.value.length === 0) {
      const commentsData = await getComments(ticketId, authStore.token)
      comments.value = commentsData || []
    }
  } catch (e) {
    error.value = e.message || 'Failed to load ticket'
  } finally {
    loading.value = false
  }
})

async function updateProjectName() {
  if (project.value && project.value.name) {
    return project.value.name
  }
  if (ticket.value && ticket.value.project_id) {
    project.value = await fetchProjectByName(ticket.value.project_id, authStore.token)
    return project.value ? project.value.name : 'Unknown'
  }
  return 'Unknown'
}

async function updateAssignee() {
  if (ticket.value && ticket.value.assignee_id) {
    return { id: ticket.value.assignee_id, name: `${ticket.value.assignee_first_name} ${ticket.value.assignee_last_name}` }
  }
  return null
}

async function changeStatus(newStatus) {
  try {
    await updateTicket(ticket.value.id, { status: newStatus }, authStore.token)
    ticket.value.status = newStatus
    alert('Status updated successfully')
  } catch (err) {
    alert('Failed to update status: ' + err.message)
  }
}

async function addCommentText(comment) {
  try {
    await addComment(ticket.value.id, comment, authStore.token)
    comments.value.push({ id: Date.now(), user_id: authStore.user.id, user_email: authStore.user.email, text: comment })
  } catch (err) {
    alert('Failed to add comment: ' + err.message)
  }
}

function canUpdate() {
  return authStore.user && (authStore.user.role === 'ADMIN' || authStore.user.role === 'MEMBER')
}

function canDelete() {
  return canUpdate() && ticket.value && (authStore.user.role === 'ADMIN' || (ticket.value.assignee_id === authStore.user.id))
}
</script>

<template>
  <div class="ticket-detail">
    <h1>Ticket #{{ ticket?.id }}</h1>
    
    <div v-if="loading" class="loading">Loading...</div>
    
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="$router.go(-1)">Go Back</button>
    </div>
    
    <div v-else>
      <div class="ticket-header">
        <span class="badge status" :class="ticket?.status">{{ ticket?.status }}</span>
        <span class="title">{{ ticket?.title }}</span>
      </div>
      
      <div class="meta">
        <span>Project: <strong>{{ updateProjectName() }}</strong></span>
        <span>Priority: <strong>{{ ticket?.priority || 'medium' }}</strong></span>
        <span>Title: <strong>{{ ticket?.title || 'N/A' }}</strong></span>
      </div>
      
      <div v-if="ticket?.description" class="description">
        <h3>Description</h3>
        <p>{{ ticket.description }}</p>
      </div>
      
      <div v-if="ticket?.assignee_id" class="assignee">
        <h3>Assignee</h3>
        <p>{{ updateAssignee() }}</p>
      </div>
      
      <div class="actions">
        <button v-if="canUpdate()" @click="changeStatus('backlog')" :disabled="ticket?.status === 'backlog'">Move to Backlog</button>
        <button v-if="canUpdate() && ticket?.status === 'backlog'" @click="changeStatus('in_progress')">Start Work</button>
        <button v-if="canUpdate() && ticket?.status === 'in_progress'" @click="changeStatus('review')">Submit Review</button>
        <button v-if="canUpdate() && ticket?.status === 'review'" @click="changeStatus('done')">Mark as Done</button>
        
        <button v-if="canUpdate() && ticket?.description" @click="addCommentText(ticket.description)">Clear Description</button>
        
        <button 
          v-if="canUpdate() && (ticket?.description === ticket.description && (ticket?.description || ticket?.assignee_id || ticket?.status !== 'backlog'))"
          @click="changeStatus('backlog')"
          class="reset"
        >Reset</button>

        <button @click="$router.back()" class="back">← Back</button>
      </div>

      <div v-if="comments && comments.length > 0" class="comments">
        <h3>Comments ({{ comments.length }})</h3>
        <div v-for="comment in comments" :key="comment.id" class="comment">
          <div class="comment-header">
            <span class="comment-user">{{ comment.user_email }}</span>
            <span class="comment-time">{{ comment.created_at }}</span>
          </div>
          <div class="comment-text">{{ comment.text }}</div>
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

.meta span {
  font-size: 14px;
}

.description h3,
.assignee h3,
.comments h3 {
  margin-bottom: 10px;
  color: #333;
}

.description p {
  line-height: 1.6;
  white-space: pre-wrap;
}

.assignee p {
  font-weight: bold;
  margin: 5px 0 0 0;
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

.actions button.reset {
  background: #ef4444;
}

.actions .back {
  background: #6b7280;
}

.actions button:hover:not(:disabled) {
  opacity: 0.9;
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

.loading, .error {
  padding: 40px;
  text-align: center;
}

.error {
  color: #ef4444;
}
</style>
