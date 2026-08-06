<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getRepoStatus, connectRepo, disconnectRepo, listBranches, createBranch, deleteBranch, listPRs, createPR } from '@/api/github'

const route = useRoute()
const projectId = route.params.id

const repoLoading = ref(true)
const repoError = ref(null)
const repoSuccess = ref(null)
const githubRepo = ref(null)
const showConnectForm = ref(false)
const repoUrl = ref('')
const repoBranch = ref('main')
const repoAccessToken = ref('')

const branches = ref([])
const showCreateBranch = ref(false)
const branchTicketId = ref('')

const prs = ref([])
const showCreatePR = ref(false)
const prTicketId = ref('')
const prTitle = ref('')
const prBody = ref('')
const prBranchName = ref('')

const actionLoading = ref(null)

onMounted(async () => {
  repoLoading.value = true
  try {
    githubRepo.value = await getRepoStatus(projectId)
    if (githubRepo.value?.connected) {
      await loadBranches()
      await loadPRs()
    }
  } catch (_err) {
    repoError.value = 'Failed to load GitHub status'
  } finally {
    repoLoading.value = false
  }
})

async function loadBranches() {
  try {
    branches.value = await listBranches(projectId)
  } catch (_err) {
    console.error('Failed to load branches:', _err)
  }
}

async function loadPRs() {
  try {
    prs.value = await listPRs(projectId)
  } catch (_err) {
    console.error('Failed to load PRs:', _err)
  }
}

async function handleConnectRepo() {
  if (!repoUrl.value.trim()) return
  repoLoading.value = true
  repoError.value = null
  repoSuccess.value = null
  try {
    await connectRepo(projectId, repoUrl.value.trim(), repoAccessToken.value.trim())
    repoSuccess.value = 'Repository connected successfully'
    await loadBranches()
    await loadPRs()
    showConnectForm.value = false
    repoUrl.value = ''
    repoBranch.value = 'main'
    repoAccessToken.value = ''
    const status = await getRepoStatus(projectId)
    githubRepo.value = status
  } catch (err) {
    repoError.value = err.message || 'Failed to connect repository'
  } finally {
    repoLoading.value = false
  }
}

async function handleDisconnectRepo() {
  repoLoading.value = true
  repoError.value = null
  try {
    await disconnectRepo(projectId)
    githubRepo.value = null
    branches.value = []
    prs.value = []
  } catch (err) {
    repoError.value = err.message || 'Failed to disconnect repository'
  } finally {
    repoLoading.value = false
  }
}

async function handleCreateBranch() {
  if (!branchTicketId.value.trim()) return
  actionLoading.value = 'branch'
  repoError.value = null
  repoSuccess.value = null
  try {
    await createBranch(branchTicketId.value.trim(), `ticket-${branchTicketId.value.trim()}`, projectId)
    repoSuccess.value = 'Branch created successfully'
    await loadBranches()
    branchTicketId.value = ''
    branchName.value = ''
    showCreateBranch.value = false
  } catch (err) {
    repoError.value = err.message || 'Failed to create branch'
  } finally {
    actionLoading.value = null
  }
}

async function handleDeleteBranch(ticketId) {
  actionLoading.value = `delete-${ticketId}`
  try {
    await deleteBranch(ticketId)
    repoSuccess.value = 'Branch deleted successfully'
    await loadBranches()
  } catch (err) {
    repoError.value = err.message || 'Failed to delete branch'
  } finally {
    actionLoading.value = null
  }
}

async function handleCreatePR() {
  if (!prTicketId.value.trim() || !prTitle.value.trim() || !prBranchName.value.trim()) return
  actionLoading.value = 'pr'
  repoError.value = null
  repoSuccess.value = null
  try {
    await createPR(prTicketId.value.trim(), prBody.value.trim())
    repoSuccess.value = 'PR created successfully'
    await loadPRs()
    prTicketId.value = ''
    prTitle.value = ''
    prBody.value = ''
    prBranchName.value = ''
    showCreatePR.value = false
  } catch (err) {
    repoError.value = err.message || 'Failed to create PR'
  } finally {
    actionLoading.value = null
  }
}
</script>

<template>
  <div class="github-connections">
    <div v-if="repoLoading" class="loading">Loading GitHub status...</div>
    <div v-else-if="repoError" class="error">
      <p>{{ repoError }}</p>
    </div>
    <div v-else>
      <h1>GitHub Connections</h1>
      <p class="subtitle">Manage your GitHub repository integration</p>

      <div v-if="repoSuccess" class="success">{{ repoSuccess }}</div>

      <!-- Repository Section -->
      <div class="section">
        <h2>Repository</h2>
        <div v-if="!githubRepo?.connected" class="repo-section">
          <p class="description">Connect your GitHub repository to enable branch creation, PR management, and ticket tracking.</p>
          <div v-if="showConnectForm" class="connect-form">
            <input v-model="repoUrl" type="text" placeholder="https://github.com/owner/repo" class="input" />
            <input v-model="repoBranch" type="text" placeholder="Branch (default: main)" class="input" />
            <input v-model="repoAccessToken" type="password" placeholder="GitHub Personal Access Token" class="input" />
            <div class="form-actions">
              <button @click="handleConnectRepo" class="btn-primary">Connect</button>
              <button @click="showConnectForm = false" class="btn-secondary">Cancel</button>
            </div>
          </div>
          <button v-else @click="showConnectForm = true" class="btn-primary">Connect Repository</button>
        </div>
        <div v-else class="repo-connected">
          <div class="repo-info">
            <span class="status-connected">Connected</span>
            <span class="repo-url">{{ githubRepo.repo_url }}</span>
            <span class="repo-branch">Default branch: {{ githubRepo.default_branch }}</span>
          </div>
          <button @click="handleDisconnectRepo" class="btn-danger">Disconnect</button>
        </div>
      </div>

      <!-- Branches Section -->
      <div class="section" v-if="githubRepo?.connected">
        <div class="section-header">
          <h2>Branches</h2>
          <button @click="showCreateBranch = true" class="btn-primary">Create Branch</button>
        </div>

        <div v-if="showCreateBranch" class="modal">
          <div class="modal-content">
            <h3>Create Branch</h3>
            <input v-model="branchTicketId" type="text" placeholder="Ticket ID" class="input" />
            <div class="form-actions">
              <button @click="handleCreateBranch" :disabled="actionLoading === 'branch'" class="btn-primary">
                {{ actionLoading === 'branch' ? 'Creating...' : 'Create' }}
              </button>
              <button @click="showCreateBranch = false" class="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>

        <div v-if="branches.length === 0" class="empty-state">
          <p>No branches found</p>
        </div>
        <div v-else class="branches-list">
          <div v-for="branch in branches" :key="branch.name" class="branch-item">
            <span class="branch-name">{{ branch.name }}</span>
            <button
              @click="handleDeleteBranch(branch.ticket_id)"
              :disabled="actionLoading === `delete-${branch.ticket_id}`"
              class="btn-delete"
            >
              {{ actionLoading === `delete-${branch.ticket_id}` ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>

      <!-- PRs Section -->
      <div class="section" v-if="githubRepo?.connected">
        <div class="section-header">
          <h2>Pull Requests</h2>
          <button @click="showCreatePR = true" class="btn-primary">Create PR</button>
        </div>

        <div v-if="showCreatePR" class="modal">
          <div class="modal-content">
            <h3>Create Pull Request</h3>
            <input v-model="prTicketId" type="text" placeholder="Ticket ID" class="input" />
            <input v-model="prTitle" type="text" placeholder="PR Title" class="input" />
            <textarea v-model="prBody" placeholder="PR Body (optional)" class="textarea" rows="4" />
            <input v-model="prBranchName" type="text" placeholder="Branch Name" class="input" />
            <div class="form-actions">
              <button @click="handleCreatePR" :disabled="actionLoading === 'pr'" class="btn-primary">
                {{ actionLoading === 'pr' ? 'Creating...' : 'Create PR' }}
              </button>
              <button @click="showCreatePR = false" class="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>

        <div v-if="prs.length === 0" class="empty-state">
          <p>No pull requests found</p>
        </div>
        <div v-else class="prs-list">
          <div v-for="pr in prs" :key="pr.id" class="pr-item">
            <div class="pr-info">
              <router-link :to="pr.html_url" target="_blank" class="pr-link">
                #{{ pr.number }} {{ pr.title }}
              </router-link>
              <span :class="['pr-state', pr.state]">{{ pr.state }}</span>
            </div>
            <span class="pr-branch">{{ pr.head_ref }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.github-connections {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.github-connections h1 {
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

.success {
  padding: 12px 16px;
  background: #d1fae5;
  border: 1px solid #6ee7b7;
  border-radius: 6px;
  color: #065f46;
  margin-bottom: 16px;
}

.section {
  margin-top: 32px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
}

.section h2 {
  font-size: 18px;
  color: #1f2937;
  margin: 0 0 16px 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h2 {
  margin: 0;
}

.description {
  color: #6b7280;
  margin: 0 0 16px 0;
}

.connect-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.repo-connected {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.repo-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-connected {
  color: #10b981;
  font-weight: 600;
}

.repo-url {
  color: #3b82f6;
  font-size: 14px;
}

.repo-branch {
  color: #6b7280;
  font-size: 13px;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: #6b7280;
}

.branches-list,
.prs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #f9fafb;
  border-radius: 6px;
}

.branch-name {
  font-family: monospace;
  color: #374151;
  font-size: 14px;
}

.pr-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #f9fafb;
  border-radius: 6px;
}

.pr-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pr-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 500;
  font-size: 14px;
}

.pr-link:hover {
  text-decoration: underline;
}

.pr-state {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.pr-state.open {
  background: #d1fae5;
  color: #065f46;
}

.pr-state.closed {
  background: #fee2e2;
  color: #991b1b;
}

.pr-branch {
  font-family: monospace;
  color: #6b7280;
  font-size: 13px;
}

.input,
.textarea {
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  width: 100%;
}

.textarea {
  resize: vertical;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.btn-primary {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #f9fafb;
}

.btn-danger {
  padding: 10px 20px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-danger:hover {
  background: #dc2626;
}

.btn-delete {
  padding: 6px 12px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-delete:hover:not(:disabled) {
  background: #fecaca;
}

.btn-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 90%;
  max-width: 480px;
}

.modal-content h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  color: #1f2937;
}

.modal-content .input,
.modal-content .textarea {
  margin-bottom: 12px;
}
</style>
