<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AIAssistant from './AIAssistant.vue'
import { useGitHub } from '@/composables/useGitHub'
import { useUsage } from '@/composables/useUsage'
import { useMemory } from '@/composables/useMemory'
import { useTabNavigation } from '@/composables/useTabNavigation'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id

const isChildRoute = computed(() => route.name !== 'ProjectDetail')

const tabs = [
  { id: 'tickets', label: 'Tickets' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'github', label: 'GitHub', lazyLoad: async () => await github.load(), loaded: ref(false) },
  { id: 'ai', label: 'AI Chat' },
  { id: 'usage', label: 'Usage & Billing', lazyLoad: async () => { await usage.loadUsage(); await usage.loadBilling() }, loaded: ref(false) },
  { id: 'memory', label: 'Memory', lazyLoad: async () => await memory.load(), loaded: ref(false) },
]

const { activeTab } = useTabNavigation(tabs)

const github = useGitHub(projectId)
const usage = useUsage(projectId)
const memory = useMemory(projectId)

onMounted(() => {
  if (activeTab.value === 'github') github.load()
  if (activeTab.value === 'usage') { usage.loadUsage(); usage.loadBilling() }
  if (activeTab.value === 'memory') memory.load()
})

async function handleTabSwitch(tabId) {
  if (activeTab.value === tabId) return
  const tab = tabs.find(t => t.id === tabId)
  if (tab?.lazyLoad && tab.loaded) {
    await tab.lazyLoad()
    tab.loaded.value = true
  }
  activeTab.value = tabId
  if (tabId === 'tickets') {
    router.push(`/projects/${projectId}/tickets`)
  } else if (tabId === 'ai') {
    router.push(`/projects/${projectId}/ai`)
  }
}

</script>

<template>
  <div class="project-detail">
    <div class="project-header">
      <h1>Project Settings</h1>
    </div>

    <div class="quick-links">
      <router-link :to="`/projects/${projectId}/templates`" class="quick-link-card">
        <span class="quick-link-icon">📄</span>
        <div class="quick-link-info">
          <span class="quick-link-title">Custom Templates</span>
          <span class="quick-link-desc">Manage document templates</span>
        </div>
      </router-link>
    </div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="{ active: activeTab === tab.id }"
        @click="handleTabSwitch(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="tab-content">
      <div v-if="activeTab === 'tickets'" class="tab-panel">
        <router-view v-if="isChildRoute" />
        <router-link v-else :to="`/projects/${projectId}/tickets`" class="btn-primary">
          View Kanban Board
        </router-link>
      </div>

      <div v-if="activeTab === 'approvals'" class="tab-panel">
        <router-link :to="`/projects/${projectId}/approvals`" class="btn-primary">
          View Project Approvals
        </router-link>
      </div>

      <div v-if="activeTab === 'ai'" class="tab-panel">
        <router-view v-if="isChildRoute" />
        <AIAssistant v-else />
      </div>

      <div v-if="activeTab === 'github'" class="tab-panel">
        <div class="tab-header">
          <h2>GitHub</h2>
          <router-link :to="`/projects/${projectId}/github`" class="btn-secondary">Manage GitHub</router-link>
        </div>
        <div v-if="github.loading" class="loading">Loading...</div>
        <div v-else>
          <div v-if="github.error" class="error">{{ github.error }}</div>
          <div v-if="github.success" class="success">{{ github.success }}</div>

          <div v-if="!github.repo?.connected" class="github-section">
            <h3>Connect Repository</h3>
            <p class="description">Link your GitHub repository to enable branch creation, PR management, and ticket tracking.</p>
            <button v-if="!github.showConnectForm" @click="github.showConnectForm = true" class="btn-primary">Connect Repository</button>

            <div v-if="github.showConnectForm" class="connect-form">
              <div class="form-group">
                <label>Repository URL</label>
                <input v-model="github.repoUrl" type="text" placeholder="https://github.com/owner/repo" />
              </div>
              <div class="form-group">
                <label>Default Branch</label>
                <input v-model="github.repoBranch" type="text" placeholder="main" />
              </div>
              <div class="form-group">
                <label>GitHub Personal Access Token</label>
                <input v-model="github.repoAccessToken" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              </div>
              <div class="form-actions">
                <button @click="github.connect" :disabled="github.loading" class="btn-submit">
                  {{ github.loading ? 'Connecting...' : 'Connect' }}
                </button>
                <button @click="github.showConnectForm = false" class="btn-cancel">Cancel</button>
              </div>
            </div>
          </div>

          <div v-else class="github-connected">
            <div class="repo-info">
              <h3>Connected Repository</h3>
              <div class="repo-badge">
                <span class="repo-url">{{ github.repo.repo_url }}</span>
                <span class="repo-branch">{{ github.repo.default_branch }}</span>
              </div>
              <button @click="github.disconnect" :disabled="github.loading" class="btn-danger">Disconnect</button>
            </div>

            <div class="github-panels">
              <div class="panel">
                <h4>Branches</h4>
                <div v-if="github.branches.length === 0" class="empty">No branches yet</div>
                <ul v-else class="branch-list">
                  <li v-for="branch in github.branches" :key="branch.name" :class="{ default: branch.is_default }">
                    <span>{{ branch.name }}</span>
                    <span v-if="branch.is_default" class="badge">default</span>
                  </li>
                </ul>
                <div class="create-branch">
                  <input v-model="github.branchTicketId" type="text" placeholder="Ticket ID for branch" />
                  <button @click="github.createBranch(github.branchTicketId)" :disabled="github.creatingBranch || !github.branchTicketId" class="btn-small">
                    {{ github.creatingBranch ? 'Creating...' : 'Create Branch' }}
                  </button>
                </div>
              </div>

              <div class="panel">
                <h4>Pull Requests</h4>
                <div v-if="github.prs.length === 0" class="empty">No PRs yet</div>
                <ul v-else class="pr-list">
                  <li v-for="pr in github.prs" :key="pr.id">
                    <a :href="pr.html_url" target="_blank" rel="noopener">{{ pr.title }}</a>
                    <span :class="['pr-state', pr.state]">{{ pr.state }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'usage'" class="tab-panel">
        <div class="usage-billing">
          <div class="section">
            <h3>Usage</h3>
            <div v-if="usage.usageLoading" class="loading">Loading...</div>
            <div v-else-if="usage.usageError" class="error">{{ usage.usageError }}</div>
            <div v-else-if="!usage.usage" class="empty">No usage data available</div>
            <div v-else class="usage-grid">
              <div class="usage-card">
                <div class="usage-value">{{ usage.usage.totals?.totalCalls || 0 }}</div>
                <div class="usage-label">Total Calls</div>
              </div>
              <div class="usage-card">
                <div class="usage-value">${{ (usage.usage.totals?.totalCost || 0).toFixed(4) }}</div>
                <div class="usage-label">Total Cost</div>
              </div>
              <div class="usage-card">
                <div class="usage-value">{{ (usage.usage.totals?.totalTokensIn || 0) + (usage.usage.totals?.totalTokensOut || 0) }}</div>
                <div class="usage-label">Total Tokens</div>
              </div>
            </div>

            <div v-if="usage.usage?.breakdown && usage.usage.breakdown.length > 0" class="model-breakdown">
              <h4>Usage by Model</h4>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Tokens In</th>
                    <th>Tokens Out</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="model in usage.usage.breakdown" :key="model.model">
                    <td>{{ model.model }}</td>
                    <td>{{ model.calls || 0 }}</td>
                    <td>{{ (model.tokens_in || 0).toLocaleString() }}</td>
                    <td>{{ (model.tokens_out || 0).toLocaleString() }}</td>
                    <td>${{ (model.cost || 0).toFixed(4) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="section">
            <h3>Billing</h3>
            <div v-if="usage.billingLoading" class="loading">Loading...</div>
            <div v-else-if="usage.billingError" class="error">{{ usage.billingError }}</div>
            <div v-else-if="!usage.billing || usage.billing.length === 0" class="empty">No billing data available</div>
            <div v-else class="billing-info">
              <div class="billing-card">
                <div class="billing-value">${{ (usage.billing.reduce((sum, r) => sum + (r.total_cost || 0), 0) || 0).toFixed(4) }}</div>
                <div class="billing-label">Total Cost</div>
              </div>
              <div class="billing-card">
                <div class="billing-value">{{ usage.billing.reduce((sum, r) => sum + (r.total_calls || 0), 0) || 0 }}</div>
                <div class="billing-label">Total Calls</div>
              </div>
            </div>

            <div v-if="usage.billing.length > 0" class="daily-costs">
              <h4>Usage by Provider & Model</h4>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Calls</th>
                    <th>Tokens In</th>
                    <th>Tokens Out</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in usage.billing" :key="row.provider_type + '-' + row.model">
                    <td>{{ row.provider_type }}</td>
                    <td>{{ row.model }}</td>
                    <td>{{ row.total_calls || 0 }}</td>
                    <td>{{ (row.total_in || 0).toLocaleString() }}</td>
                    <td>{{ (row.total_out || 0).toLocaleString() }}</td>
                    <td>${{ (row.total_cost || 0).toFixed(4) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'memory'" class="tab-panel">
        <div v-if="memory.memoryLoading" class="loading">Loading...</div>
        <div v-else>
          <div v-if="memory.memoryError" class="error">{{ memory.memoryError }}</div>
          <div class="panel-header">
            <h3>Agent Memory</h3>
            <button v-if="!memory.showAddMemory" @click="memory.showAddMemory = true" class="btn-primary">Add Memory</button>
          </div>

          <div class="memory-search">
            <input
              v-model="memory.searchQuery"
              @keyup.enter="memory.handleSearch"
              @input="memory.handleSearch"
              placeholder="Search memories by content..."
              class="search-input"
            />
            <button v-if="memory.searchQuery || memory.searchResults.length > 0" @click="memory.clearSearch" class="clear-btn">
              {{ memory.searchResults.length > 0 ? 'Clear Search' : 'Clear' }}
            </button>
          </div>

          <div v-if="memory.isSearching" class="loading">Searching...</div>
          <template v-else>
            <div v-if="memory.searchResults.length > 0" class="search-results">
              <p class="search-info">Found {{ memory.searchResults.length }} memory{{ memory.searchResults.length !== 1 ? 'ies' : 'y' }} matching "{{ memory.searchQuery }}"</p>
              <div class="memory-list">
                <div v-for="m in memory.searchResults" :key="m.id" class="memory-card">
                  <div class="memory-content">{{ m.content }}</div>
                  <div class="memory-meta">
                    <span>{{ new Date(m.created_at).toLocaleDateString() }}</span>
                    <span>{{ m.created_by_name || 'Unknown' }}</span>
                  </div>
                  <div class="memory-actions">
                    <button v-if="!memory.editingMemory || memory.editingMemory.id !== m.id" @click="memory.editingMemory = m; memory.editMemoryContent = m.content" class="btn-small">Edit</button>
                    <button @click="memory.handleDelete(m.id)" :disabled="memory.memoryDeleting === m.id" class="btn-small btn-danger">
                      {{ memory.memoryDeleting === m.id ? 'Deleting...' : 'Delete' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-else-if="memory.memories.length === 0 && !memory.showAddMemory" class="empty">
              <p>No memories stored yet.</p>
            </div>
            <div v-else class="memory-list">
              <div v-for="m in memory.memories" :key="m.id" class="memory-card">
                <div class="memory-content">{{ m.content }}</div>
                <div class="memory-meta">
                  <span>{{ new Date(m.created_at).toLocaleDateString() }}</span>
                  <span>{{ m.created_by_name || 'Unknown' }}</span>
                </div>
                <div class="memory-actions">
                  <button v-if="!memory.editingMemory || memory.editingMemory.id !== m.id" @click="memory.editingMemory = m; memory.editMemoryContent = m.content" class="btn-small">Edit</button>
                  <button @click="memory.handleDelete(m.id)" :disabled="memory.memoryDeleting === m.id" class="btn-small btn-danger">
                    {{ memory.memoryDeleting === m.id ? 'Deleting...' : 'Delete' }}
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div v-if="memory.showAddMemory" class="add-form">
            <div class="form-group">
              <label>Content</label>
              <textarea v-model="memory.editMemoryContent" rows="3" placeholder="Enter memory content..."></textarea>
            </div>
            <div class="form-actions">
              <button @click="memory.handleAdd" :disabled="memory.memorySaving" class="btn-submit">
                {{ memory.memorySaving ? 'Adding...' : 'Add' }}
              </button>
              <button @click="memory.showAddMemory = false" class="btn-cancel">Cancel</button>
            </div>
          </div>

          <div v-if="memory.editingMemory && memory.editingMemory.id !== undefined" class="edit-form">
            <div class="form-group">
              <label>Edit Memory</label>
              <textarea v-model="memory.editMemoryContent" rows="3"></textarea>
            </div>
            <div class="form-actions">
              <button @click="memory.handleUpdate" :disabled="memory.memorySaving" class="btn-submit">
                {{ memory.memorySaving ? 'Saving...' : 'Save' }}
              </button>
              <button @click="memory.editingMemory = null" class="btn-cancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.project-detail {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.project-header {
  margin-bottom: 20px;
}

.project-header h1 {
  margin: 0;
  font-size: 24px;
  color: #1f2937;
}

.quick-links {
  margin-bottom: 20px;
}

.quick-link-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  text-decoration: none;
  transition: all 0.2s;
}

.quick-link-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.quick-link-icon {
  font-size: 24px;
}

.quick-link-info {
  display: flex;
  flex-direction: column;
}

.quick-link-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.quick-link-desc {
  font-size: 12px;
  color: #6b7280;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 2px solid #e5e7eb;
  margin-bottom: 24px;
}

.tabs button {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
  transition: all 0.2s;
}

.tabs button:hover {
  color: #374151;
}

.tabs button.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.tab-content {
  min-height: 400px;
}

.tab-panel {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.loading, .error, .empty {
  padding: 40px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.success {
  color: #10b981;
  padding: 12px 16px;
  background: #d1fae5;
  border-radius: 6px;
  margin-bottom: 16px;
}

.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
  display: inline-block;
}

.btn-primary:hover {
  background: #2563eb;
}

.btn-submit {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-submit:disabled {
  background: #9ca3af;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-danger {
  background: #ef4444 !important;
  color: white !important;
  border-color: #ef4444 !important;
}

.btn-danger:hover {
  background: #dc2626 !important;
}

.btn-small {
  padding: 4px 10px;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.btn-small:hover {
  background: #e5e7eb;
}

.btn-small.btn-danger {
  background: white !important;
  color: #dc2626 !important;
  border-color: #fecaca !important;
}

.github-section, .github-connected {
  margin-top: 16px;
}

.github-section .description {
  color: #6b7280;
  margin: 8px 0 16px;
}

.connect-form {
  background: #f9fafb;
  padding: 20px;
  border-radius: 8px;
  margin-top: 16px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.form-group label .optional {
  font-weight: 400;
  color: #9ca3af;
  font-size: 12px;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.repo-info {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.repo-badge {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f3f4f6;
  padding: 8px 16px;
  border-radius: 6px;
  flex: 1;
}

.repo-url {
  font-family: monospace;
  color: #374151;
}

.repo-branch {
  background: #3b82f6;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.github-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.panel {
  background: #f9fafb;
  padding: 16px;
  border-radius: 8px;
}

.panel h4, .provider-config-panel h3 {
  margin: 0 0 12px;
  color: #374151;
}

.branch-list, .pr-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.branch-list li, .pr-list li {
  padding: 8px;
  margin-bottom: 4px;
  background: white;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.branch-list li.default {
  background: #dbeafe;
}

.branch-list .badge {
  background: #3b82f6;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
}

.pr-list a {
  color: #3b82f6;
  text-decoration: none;
}

.pr-list a:hover {
  text-decoration: underline;
}

.pr-state {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.pr-state.open {
  background: #d1fae5;
  color: #065f46;
}

.pr-state.closed {
  background: #fee2e2;
  color: #991b1b;
}

.create-branch {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.create-branch input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.add-form, .edit-form {
  background: #f9fafb;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.usage-billing {
  display: grid;
  gap: 24px;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.usage-card, .billing-card {
  background: #f9fafb;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
}

.usage-value, .billing-value {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}

.usage-label, .billing-label {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

.model-breakdown, .daily-costs {
  margin-top: 20px;
}

.model-breakdown h4, .daily-costs h4 {
  margin: 0 0 12px;
  color: #374151;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th, .data-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
  font-size: 13px;
}

.data-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
}

.memory-search {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
}

.clear-btn {
  padding: 8px 16px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
}

.clear-btn:hover {
  background: #e5e7eb;
}

.search-results {
  margin-bottom: 16px;
}

.search-info {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #f9fafb;
  border-radius: 6px;
}

.memory-list {
  display: grid;
  gap: 12px;
}

.memory-card {
  padding: 16px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.memory-content {
  color: #374151;
  line-height: 1.5;
  margin-bottom: 8px;
}

.memory-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 8px;
}

.memory-actions {
  display: flex;
  gap: 6px;
}

@media (max-width: 768px) {
  .github-panels,
  .usage-grid {
    grid-template-columns: 1fr;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

}
</style>
