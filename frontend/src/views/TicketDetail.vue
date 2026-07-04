<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchTicket, updateTicket, addComment, fetchComments, deleteTicket } from '@/api/tickets'
import { getTicketApprovals, createApproval } from '@/api/approvals'
import { fetchAttachments, uploadAttachment, deleteAttachment } from '@/api/ticketAttachments'
import { listPlanningFiles, getPlanningFile, upsertPlanningFile, applyTemplate, updatePlanningStatus } from '@/api/ticketPlanning'
import { listTemplates } from '@/api/templates'
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
const attachments = ref([])
const uploading = ref(false)
const uploadError = ref('')
const modalError = ref('')

const ticketId = route.params.ticketId
const approvals = ref([])
const approving = ref(false)

// Planning state
const planningFiles = ref([])
const planningLoading = ref(false)
const planningError = ref(null)
const planningSuccess = ref(null)
const editingFile = ref(null)
const editingContent = ref('')
const savingFile = ref(false)
const applyingTemplate = ref(false)
const showTemplateSelect = ref(false)
const selectedTemplate = ref('')
const planningStatus = ref('')
const customTemplates = ref([])

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
  if (!authStore.user.value) return false
  if (authStore.canUpdateTicket()) return true
  if (authStore.hasRole('user') && ticket.value?.owner_id === authStore.user.value.id) return true
  return false
}

const canDelete = () => {
  if (!authStore.user.value) return false
  if (authStore.canDeleteTicket()) return true
  if (authStore.hasRole('user') && ticket.value?.owner_id === authStore.user.value.id) return true
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
      attachments.value = await fetchAttachments(ticketId)
      await loadPlanning()
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

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 // 10 MB

async function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file || !ticket.value) return
  uploading.value = true
  uploadError.value = ''
  try {
    await uploadAttachment(ticket.value.id, file)
    attachments.value = await fetchAttachments(ticket.value.id)
    event.target.value = ''
  } catch (err) {
    console.error('Failed to upload file:', err)
    if (err.status === 413) {
      uploadError.value = `File too large. Maximum allowed size is ${formatFileSize(MAX_UPLOAD_SIZE)}.`
    } else {
      uploadError.value = err.message || 'Failed to upload file'
    }
  } finally {
    uploading.value = false
  }
}

async function handleDeleteAttachment(attachmentId) {
  if (!ticket.value) return
  try {
    await deleteAttachment(ticket.value.id, attachmentId)
    attachments.value = attachments.value.filter(a => a.id !== attachmentId)
  } catch (err) {
    console.error('Failed to delete attachment:', err)
    uploadError.value = err.message || 'Failed to delete attachment'
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i]
}

function downloadAttachment(attachment) {
  const token = localStorage.getItem('vibecode_token')
  const url = `/api/v1/attachments/${attachment.id}?ticketId=${ticketId}`
  fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(res => {
      if (!res.ok) throw new Error('Download failed')
      return res.blob()
    })
    .then(blob => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = attachment.filename
      link.click()
      URL.revokeObjectURL(link.href)
    })
    .catch(err => {
      console.error('Failed to download attachment:', err)
      uploadError.value = 'Failed to download attachment'
    })
}

async function loadPlanning() {
  planningLoading.value = true
  planningError.value = null
  try {
    planningFiles.value = await listPlanningFiles(ticketId)
    if (planningFiles.value.length > 0) {
      const mainFile = planningFiles.value.find(f => f.key === 'planning.md') || planningFiles.value[0]
      const content = await getPlanningFile(ticketId, mainFile.key)
      editingFile.value = mainFile
      editingContent.value = content?.content || ''
      planningStatus.value = mainFile.status || ''
    }
  } catch (err) {
    console.error('Failed to load planning:', err)
  } finally {
    planningLoading.value = false
  }
}

async function handleApplyTemplate() {
  if (!selectedTemplate.value) return
  applyingTemplate.value = true
  modalError.value = ''
  planningError.value = null
  planningSuccess.value = null
  try {
    await applyTemplate(ticketId, selectedTemplate.value)
    planningSuccess.value = `Template "${selectedTemplate.value}" applied successfully`
    await loadPlanning()
    showTemplateSelect.value = false
    selectedTemplate.value = ''
  } catch (err) {
    modalError.value = err.message || 'Failed to apply template'
  } finally {
    applyingTemplate.value = false
  }
}

async function handleSaveFile() {
  if (!editingFile.value || !editingContent.value.trim()) return
  savingFile.value = true
  planningError.value = null
  planningSuccess.value = null
  try {
    await upsertPlanningFile(ticketId, editingFile.value.key, editingContent.value)
    planningSuccess.value = 'Planning file saved'
    await loadPlanning()
    editingFile.value = null
    editingContent.value = ''
  } catch (err) {
    planningError.value = err.message || 'Failed to save planning file'
  } finally {
    savingFile.value = false
  }
}

async function handleUpdateStatus(status) {
  if (!editingFile.value) return
  try {
    await updatePlanningStatus(ticketId, status)
    planningStatus.value = status
    planningSuccess.value = `Status updated to ${status}`
  } catch (err) {
    planningError.value = err.message || 'Failed to update status'
  }
}

async function loadPlanningFile(key) {
  try {
    const content = await getPlanningFile(ticketId, key)
    editingContent.value = content?.content || ''
  } catch (err) {
    console.error('Failed to load planning file:', err)
  }
}

async function handleShowTemplateSelect() {
  try {
    customTemplates.value = await listTemplates(ticket.value.project_id)
  } catch (err) {
    console.error('Failed to load custom templates:', err)
    customTemplates.value = []
  }
  showTemplateSelect.value = true
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

      <div class="phase-flow-link">
        <router-link :to="{ name: 'PhaseFlow', params: { id: route.params.id, ticketId: ticketId } }" class="btn-phase-flow">
          View Phase Flow
        </router-link>
      </div>

      <div v-if="hasPendingApproval" class="approval-status">
        <div class="approval-badge pending">
          ⏳ Awaiting Approval
        </div>
        <p v-if="authStore.user.value?.role === 'user'">
          Your work has been submitted for review. You'll be notified once approved.
        </p>
      </div>

      <div class="attachments">
        <h3>Attachments</h3>
        <div v-if="uploadError" class="error">{{ uploadError }}</div>
        <div v-if="canUpdate()" class="upload-area">
          <input type="file" id="file-upload" @change="handleFileUpload" :disabled="uploading" />
          <label for="file-upload" class="btn-upload" :class="{ uploading }">
            {{ uploading ? 'Uploading...' : 'Upload File' }}
          </label>
        </div>
        <div v-if="attachments.length === 0 && !uploadError" class="empty">No attachments yet</div>
        <div v-for="attachment in attachments" :key="attachment.id" class="attachment-item">
          <div class="attachment-info">
            <span class="attachment-name">{{ attachment.filename }}</span>
            <span class="attachment-meta">{{ formatFileSize(attachment.size_bytes) }} · {{ new Date(attachment.created_at).toLocaleDateString() }}</span>
          </div>
          <div class="attachment-actions">
            <button @click="downloadAttachment(attachment)" class="btn-download">Download</button>
            <button v-if="canUpdate()" @click="handleDeleteAttachment(attachment.id)" class="btn-delete-attachment">Delete</button>
          </div>
        </div>
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

      <div class="planning">
        <div class="planning-header">
          <h3>Ticket Planning</h3>
          <button v-if="!editingFile && canUpdate()" @click="handleShowTemplateSelect" class="btn-primary">Apply Template</button>
        </div>

        <div v-if="planningLoading" class="loading">Loading...</div>
        <div v-else>
          <div v-if="planningError" class="error">{{ planningError }}</div>
          <div v-if="planningSuccess" class="success">{{ planningSuccess }}</div>

          <div v-if="!editingFile && planningFiles.length === 0 && canUpdate()" class="empty">
            <p>No planning files yet. Apply a template to get started.</p>
          </div>

          <div v-if="!editingFile && planningFiles.length > 0" class="planning-list">
            <div v-for="file in planningFiles" :key="file.key" class="planning-file" :class="{ active: planningStatus === file.status }">
              <div class="file-info">
                <span class="file-name">{{ file.key }}</span>
                <span v-if="file.status" class="file-status" :class="file.status">{{ file.status }}</span>
              </div>
              <button @click="editingFile = file; editingContent = ''; loadPlanningFile(file.key)" class="btn-small">Edit</button>
            </div>
          </div>

          <div v-if="editingFile" class="planning-editor">
            <div class="editor-header">
              <h4>{{ editingFile.key }}</h4>
              <div class="editor-actions">
                <select v-if="canUpdate()" v-model="planningStatus" @change="handleUpdateStatus" class="status-select">
                  <option value="">Select Status</option>
                  <option value="draft">Draft</option>
                  <option value="review">Review</option>
                  <option value="approved">Approved</option>
                </select>
                <button @click="handleSaveFile" :disabled="savingFile" class="btn-submit">
                  {{ savingFile ? 'Saving...' : 'Save' }}
                </button>
                <button @click="editingFile = null; editingContent = ''" class="btn-cancel">Cancel</button>
              </div>
            </div>
            <textarea v-model="editingContent" rows="20" class="editor-textarea" placeholder="Enter planning content..."></textarea>
          </div>
        </div>

        <div v-if="showTemplateSelect" class="template-modal">
          <div class="modal-overlay" @click.self="showTemplateSelect = false">
            <div class="modal">
              <h2>Apply Template</h2>
              <div v-if="modalError" class="modal-error">{{ modalError }}</div>
              <div class="template-options">
                <button
                  v-for="template in ['architecture', 'technical', 'simple', 'specification']"
                  :key="template"
                  @click="selectedTemplate = template"
                  :class="['template-option', { selected: selectedTemplate === template }]"
                >
                  <h4>{{ template.charAt(0).toUpperCase() + template.slice(1) }}</h4>
                  <p v-if="template === 'architecture'">Detailed architecture planning with system design sections</p>
                  <p v-else-if="template === 'technical'">Technical implementation plan with steps and tasks</p>
                  <p v-else-if="template === 'simple'">Simple task breakdown with checkboxes</p>
                  <p v-else>Model execution specification with exact file operations</p>
                </button>
                <div v-if="customTemplates.length > 0" class="template-separator">
                  <span>Custom Templates</span>
                </div>
                <button
                  v-for="template in customTemplates"
                  :key="template.id"
                  @click="selectedTemplate = template.name"
                  :class="['template-option', 'custom-template', { selected: selectedTemplate === template.name }]"
                >
                  <h4>{{ template.name }}</h4>
                  <p v-if="template.description">{{ template.description }}</p>
                  <p v-else>Custom template ({{ template.file_definitions_count || 0 }} files)</p>
                </button>
              </div>
              <div class="modal-actions">
                <button @click="showTemplateSelect = false" class="btn-cancel">Cancel</button>
                <button @click="handleApplyTemplate" :disabled="!selectedTemplate || applyingTemplate" class="btn-primary">
                  {{ applyingTemplate ? 'Applying...' : 'Apply' }}
                </button>
              </div>
            </div>
          </div>
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

.attachments {
  margin-top: 30px;
  border-top: 1px solid #e5e7eb;
  padding-top: 20px;
}

.upload-area {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.upload-area input[type="file"] {
  display: none;
}

.btn-upload {
  padding: 8px 16px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-upload:hover:not(.uploading) {
  background: #059669;
}

.btn-upload.uploading {
  background: #9ca3af;
  cursor: not-allowed;
}

.empty {
  color: #9ca3af;
  font-size: 14px;
  margin: 10px 0;
}

.attachment-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 8px;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.attachment-name {
  font-weight: 500;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-meta {
  font-size: 12px;
  color: #9ca3af;
}

.attachment-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: 16px;
}

.btn-download {
  padding: 6px 12px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.btn-download:hover {
  background: #2563eb;
}

.btn-delete-attachment {
  padding: 6px 12px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.btn-delete-attachment:hover {
  background: #dc2626;
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

.modal-error {
  padding: 12px 16px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
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

.planning {
  margin-top: 40px;
  border-top: 1px solid #e5e7eb;
  padding-top: 20px;
}

.planning-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.planning-list {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}

.planning-file {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.planning-file.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-name {
  font-weight: 500;
  color: #374151;
  font-family: monospace;
}

.file-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.file-status.draft {
  background: #fef3c7;
  color: #92400e;
}

.file-status.review {
  background: #dbeafe;
  color: #1e40af;
}

.file-status.approved {
  background: #d1fae5;
  color: #065f46;
}

.planning-editor {
  background: #f9fafb;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 12px;
}

.editor-header h4 {
  margin: 0;
  color: #374151;
  font-family: monospace;
}

.editor-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.status-select {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  background: white;
}

.editor-textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-family: monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  min-height: 300px;
}

.template-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.template-modal .modal-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
}

.template-modal .modal {
  position: relative;
  background: white;
  border-radius: 12px;
  padding: 28px;
  width: 600px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
}

.template-options {
  display: grid;
  gap: 12px;
  margin: 20px 0;
}

.template-option {
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}

.template-option:hover {
  border-color: #3b82f6;
  background: #f9fafb;
}

.template-option.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.template-option h4 {
  margin: 0 0 8px;
  color: #1f2937;
}

.template-option p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

.template-separator {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
}

.template-separator::before,
.template-separator::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e5e7eb;
}

.template-separator span {
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.custom-template {
  border-color: #a78bfa;
}

.custom-template:hover {
  border-color: #8b5cf6;
  background: #f5f3ff;
}

.custom-template.selected {
  border-color: #8b5cf6;
  background: #ede9fe;
}

.phase-flow-link {
  margin-top: 16px;
}

.btn-phase-flow {
  display: inline-block;
  padding: 8px 16px;
  background: #8b5cf6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
}

.btn-phase-flow:hover {
  background: #7c3aed;
}
</style>
