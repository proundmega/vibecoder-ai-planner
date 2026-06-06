<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchTicket, updateTicket, addComment, fetchComments, deleteTicket } from '@/api/tickets'
import { getTicketApprovals, createApproval } from '@/api/approvals'
import TicketEditModal from '@/components/TicketEditModal.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const ticket = ref(null)
const loading = ref(true)
const error = ref(null)
const newComment = ref('')
const comments = ref([])
const showEditModal = ref(false)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

const ticketId = route.params.ticketId
const approvals = ref([])
const approving = ref(false)

const validTransitions = {
  backlog: ['in_progress'],
  in_progress: ['review', 'backlog'],
  review: ['done', 'backlog'],
  done: []
}

const hasPendingApproval = computed(() => {
  return approvals.value.some(a => a.status === 'pending')
})

const canUpdate = () => {
  const user = authStore.user.value
  if (!user) return false
  if (['project_admin', 'member', 'super_admin', 'ADMIN', 'MEMBER'].includes(user.role)) return true
  if (user.role === 'user' && ticket.value?.owner_id === user.userId) return true
  return false
}

const canDelete = () => {
  const user = authStore.user.value
  if (!user) return false
  if (['project_admin', 'member', 'super_admin', 'ADMIN', 'MEMBER'].includes(user.role)) return true
  if (user.role === 'user' && ticket.value?.owner_id === user.userId) return true
  return false
}

onMounted(async () => {
  try {
    ticket.value = await fetchTicket(ticketId)
    if (!ticket.value) {
      error.value = 'Ticket not found'
    } else {
      comments.value = await fetchComments(ticketId)
      approvals.value = await getTicketApprovals(ticketId)
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
  
  const currentStatus = ticket.value.status
  const allowed = validTransitions[currentStatus]
  
  if (!allowed?.includes(newStatus)) {
    error.value = `Cannot transition from ${currentStatus} to ${newStatus}`
    return
  }
  
  try {
    await updateTicket(ticket.value.id, { status: newStatus })
    ticket.value.status = newStatus
    error.value = null
  } catch (err) {
    console.error('Failed to update status:', err)
    error.value = 'Failed to update status: ' + err.message
  }
}

async function requestApproval() {
  if (!ticket.value) return
  approving.value = true
  error.value = null
  
  try {
    const approval = await createApproval(ticket.value.id)
    approvals.value.push(approval)
    error.value = 'Approval request submitted. Awaiting review.'
  } catch (err) {
    console.error('Failed to request approval:', err)
    error.value = err.message || 'Failed to request approval'
  } finally {
    approving.value = false
  }
}

async function handleEditSaved(updates) {
  if (ticket.value) {
    Object.assign(ticket.value, updates)
    error.value = null
  }
}

async function handleDelete() {
  deleting.value = true
  showDeleteConfirm.value = false
  
  try {
    await deleteTicket(ticket.value.id)
    router.push(`/projects/${route.params.id}/tickets`)
  } catch (err) {
    console.error('Failed to delete ticket:', err)
    error.value = 'Failed to delete ticket: ' + err.message
    deleting.value = false
    showDeleteConfirm.value = true
  }
}

async function addCommentText() {
  if (!newComment.value.trim() || !ticket.value) return
  try {
    const comment = await addComment(ticket.value.id, newComment.value.trim())
    if (comment) {
      comments.value.push(comment)
    }
    newComment.value = ''
  } catch (err) {
    console.error('Failed to add comment:', err)
    error.value = 'Failed to add comment'
  }
}
</script>

<template>
  <div class="ticket-detail">
    <div class="header-actions">
      <button @click="router.back()" class="back-btn">← Back</button>
      <div class="action-buttons">
        <button v-if="canUpdate()" @click="showEditModal = true" class="btn-edit">Edit Ticket</button>
        <button v-if="canDelete()" @click="showDeleteConfirm = true" class="btn-delete">Delete Ticket</button>
      </div>
    </div>

    <h1>Ticket #{{ ticketId }}</h1>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error && !ticket" class="error">
      <p>{{ error }}</p>
      <button @click="router.back()">Go Back</button>
    </div>

    <div v-else>
      <div class="ticket-header">
        <span class="badge status" :class="ticket?.status">{{ ticket?.status }}</span>
        <span class="title">{{ ticket?.title }}</span>
      </div>

      <div class="meta">
        <span>Priority: <strong>{{ ticket?.priority || 'medium' }}</strong></span>
        <span v-if="ticket?.assignee_name">Assignee: <strong>{{ ticket.assignee_name }}</strong></span>
        <span v-if="ticket?.owner_email">Created by: <strong>{{ ticket.owner_email }}</strong></span>
      </div>

      <div v-if="ticket?.description" class="description">
        <h3>Description</h3>
        <p>{{ ticket.description }}</p>
      </div>

      <div class="actions">
        <h3>Status Transitions</h3>
        <button v-if="canUpdate()" @click="changeStatus('backlog')" :disabled="ticket?.status === 'backlog'">Move to Backlog</button>
        <button v-if="canUpdate() && ticket?.status === 'backlog'" @click="changeStatus('in_progress')">Start Work</button>
        <button v-if="canUpdate() && ticket?.status === 'in_progress'" @click="changeStatus('review')">Submit Review</button>
        <button v-if="canUpdate() && ticket?.status === 'review' && !hasPendingApproval" @click="requestApproval">Request Approval to Done</button>
        <button v-if="canUpdate() && ticket?.status === 'review'" @click="changeStatus('done')" :disabled="hasPendingApproval">Mark as Done</button>
      </div>

      <div v-if="hasPendingApproval" class="approval-status">
        <div class="approval-badge pending">
          ⏳ Awaiting Approval
        </div>
        <p v-if="authStore.user.value?.role === 'user'">
          Your work has been submitted for review. You'll be notified once approved.
        </p>
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

    <TicketEditModal
      v-if="showEditModal && ticket"
      :ticket="ticket"
      :project-id="route.params.id"
      @close="showEditModal = false"
      @saved="handleEditSaved"
    />

    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal delete-confirm">
        <h2>Confirm Delete</h2>
        <p>Are you sure you want to delete <strong>{{ ticket?.title }}</strong>?</p>
        <p class="warning">This action cannot be undone.</p>
        <div class="modal-actions">
          <button @click="showDeleteConfirm = false" class="btn-cancel">Cancel</button>
          <button @click="handleDelete" class="btn-submit btn-danger" :disabled="deleting">
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
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

.header-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.back-btn {
  padding: 8px 16px;
  background: #6b7280;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.action-buttons {
  display: flex;
  gap: 10px;
}

.btn-edit {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.btn-delete {
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
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

.actions h3 {
  width: 100%;
  margin-bottom: 10px;
  color: #374151;
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

.approval-status {
  margin: 20px 0;
  padding: 16px;
  background: #fef3c7;
  border-radius: 8px;
  border: 1px solid #f59e0b;
}

.approval-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.approval-badge.pending {
  background: #f59e0b;
  color: white;
}

.approval-status p {
  margin: 0;
  color: #92400e;
  font-size: 14px;
}

.error button {
  margin-top: 12px;
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: white;
  border-radius: 12px;
  padding: 28px;
  width: 480px;
  max-width: 90vw;
}

.delete-confirm {
  text-align: center;
}

.delete-confirm h2 {
  margin-bottom: 16px;
  color: #ef4444;
}

.warning {
  color: #ef4444;
  font-size: 13px;
  margin: 12px 0;
}

.modal-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 20px;
}

.btn-cancel {
  padding: 10px 20px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-submit {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
}

.btn-submit:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-danger {
  background: #ef4444;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}
</style>
