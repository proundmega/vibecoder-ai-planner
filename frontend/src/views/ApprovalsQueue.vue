<script setup>
import { ref, onMounted } from 'vue'
import { getPendingApprovals, approveRequest, rejectRequest } from '@/api/approvals'
const approvalsLoading = ref(true)
const approvalsError = ref(null)
const approvals = ref([])
const actionLoading = ref(null)

onMounted(async () => {
  approvalsLoading.value = true
  try {
    const response = await getPendingApprovals()
    approvals.value = response?.data || []
  } catch (err) {
    console.error('Failed to load approvals:', err)
    approvalsError.value = 'Failed to load approvals'
  } finally {
    approvalsLoading.value = false
  }
})

async function handleApprove(id) {
  actionLoading.value = id
  try {
    await approveRequest(id)
    approvals.value = approvals.value.filter(a => a.id !== id)
  } catch (err) {
    console.error('Failed to approve:', err)
    approvalsError.value = 'Failed to approve request'
  } finally {
    actionLoading.value = null
  }
}

async function handleReject(id) {
  actionLoading.value = id
  try {
    await rejectRequest(id)
    approvals.value = approvals.value.filter(a => a.id !== id)
  } catch (err) {
    console.error('Failed to reject:', err)
    approvalsError.value = 'Failed to reject request'
  } finally {
    actionLoading.value = null
  }
}
</script>

<template>
  <div class="approvals-queue">
    <div v-if="approvalsLoading" class="loading">Loading approvals...</div>
    <div v-else-if="approvalsError" class="error">
      <p>{{ approvalsError }}</p>
    </div>
    <div v-else>
      <h1>Approvals Queue</h1>
      <p class="subtitle">Pending approval requests across all projects</p>

      <div v-if="approvals.length === 0" class="empty-state">
        <p>No pending approvals</p>
      </div>

      <div v-else class="approvals-list">
        <div v-for="approval in approvals" :key="approval.id" class="approval-card">
          <div class="approval-info">
            <div class="approval-header">
              <router-link
                :to="`/projects/${approval.project_id}/tickets/${approval.ticket_id}`"
                class="ticket-link"
              >
                Ticket #{{ approval.ticket_id }}
              </router-link>
              <span class="approval-requester">by {{ approval.requested_by_name }}</span>
            </div>
            <div class="approval-project">{{ approval.project_name }}</div>
            <div class="approval-date">{{ new Date(approval.created_at).toLocaleString() }}</div>
          </div>
          <div class="approval-actions">
            <button
              @click="handleApprove(approval.id)"
              :disabled="actionLoading === approval.id"
              class="btn-approve"
            >
              {{ actionLoading === approval.id ? 'Approving...' : 'Approve' }}
            </button>
            <button
              @click="handleReject(approval.id)"
              :disabled="actionLoading === approval.id"
              class="btn-reject"
            >
              {{ actionLoading === approval.id ? 'Rejecting...' : 'Reject' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.approvals-queue {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.approvals-queue h1 {
  margin: 0 0 8px 0;
  font-size: 28px;
  color: #1f2937;
}

.subtitle {
  margin: 0 0 24px 0;
  color: #6b7280;
  font-size: 16px;
}

.loading, .error {
  padding: 60px 20px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.empty-state p {
  color: #6b7280;
  margin: 0;
}

.approvals-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.approval-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.approval-info {
  flex: 1;
  min-width: 0;
}

.approval-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.ticket-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 600;
  font-size: 15px;
}

.ticket-link:hover {
  text-decoration: underline;
}

.approval-requester {
  color: #6b7280;
  font-size: 14px;
}

.approval-project {
  color: #374151;
  font-size: 14px;
  margin-bottom: 2px;
}

.approval-date {
  color: #9ca3af;
  font-size: 13px;
}

.approval-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.btn-approve,
.btn-reject {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-approve {
  background: #10b981;
  color: white;
}

.btn-approve:hover:not(:disabled) {
  background: #059669;
}

.btn-reject {
  background: #ef4444;
  color: white;
}

.btn-reject:hover:not(:disabled) {
  background: #dc2626;
}

.btn-approve:disabled,
.btn-reject:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
