<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useGit } from '@/composables/useGit'

const route = useRoute()
const projectId = String(route.params.id)

const {
  repos, registeredProviders, activeProvider, activeRepo, activeCapabilities,
  formCapabilities, loading, error, success, showConnectForm, form, branches,
  reviews, actionLoading, providerLabel, applyProviderDefaults, load, connect,
  disconnect, createBranch, deleteBranch, createReview,
} = useGit(projectId)

const branchTicketId = ref('')
const reviewTicketId = ref('')
const reviewDescription = ref('')

onMounted(load)
</script>

<template>
  <div class="git-connections">
    <div v-if="loading" class="loading">Loading Git status...</div>
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
    </div>
    <div v-else>
      <h1>Git Connections</h1>
      <p class="subtitle">Connect GitHub, Forgejo/Gitea or a local bare repository</p>

      <div v-if="success" class="success">{{ success }}</div>

      <div class="section">
        <div class="section-header">
          <h2>Connections</h2>
          <button v-if="repos.length > 0" @click="showConnectForm = !showConnectForm" class="btn-secondary">
            {{ showConnectForm ? 'Cancel' : 'Add connection' }}
          </button>
        </div>

        <div v-if="repos.length === 0 && !showConnectForm" class="empty-state">
          <p>No repository connected yet.</p>
          <button @click="showConnectForm = true" class="btn-primary">Connect repository</button>
        </div>

        <div v-if="repos.length > 0" class="connection-list">
          <button
            v-for="row in repos"
            :key="row.provider"
            type="button"
            :class="['connection-card', { active: row.provider === activeProvider }]"
            @click="activeProvider = row.provider"
          >
            <span class="provider-badge">{{ providerLabel(row.provider) }}</span>
            <span class="repo-url">{{ row.repoUrl }}</span>
            <span class="repo-meta">Default branch: {{ row.defaultBranch || 'main' }}</span>
            <span class="repo-meta">Auth: {{ row.authMode || 'app' }}</span>
          </button>
        </div>

        <div v-if="showConnectForm" class="connect-form">
          <label class="field">
            <span>Provider</span>
            <select v-model="form.provider" @change="applyProviderDefaults(form.provider)">
              <option v-for="provider in registeredProviders" :key="provider.id" :value="provider.id">
                {{ provider.label }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>Repository URL</span>
            <input
              v-model="form.repoUrl"
              type="text"
              :placeholder="form.provider === 'github' ? 'https://github.com/owner/repo' : 'owner/repo'"
            />
          </label>

          <label v-if="formCapabilities?.requiresBaseUrl" class="field">
            <span>Base URL</span>
            <input v-model="form.baseUrl" type="text" placeholder="https://git.example.com" />
          </label>

          <label class="field">
            <span>Auth mode</span>
            <select v-model="form.authMode">
              <option v-for="mode in formCapabilities?.authModes ?? ['pat']" :key="mode" :value="mode">
                {{ mode }}
              </option>
            </select>
          </label>

          <label v-if="form.authMode !== 'ssh'" class="field">
            <span>Access token</span>
            <input v-model="form.token" type="password" placeholder="Scoped repository token" />
            <small v-if="form.authMode === 'app'">
              Used once to validate access; agents use the GitHub App installation token.
            </small>
          </label>

          <label v-if="form.authMode === 'ssh'" class="field">
            <span>SSH private key</span>
            <textarea v-model="form.sshKey" rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
          </label>

          <label class="field">
            <span>Default branch (optional)</span>
            <input v-model="form.defaultBranch" type="text" placeholder="main" />
          </label>

          <div class="form-actions">
            <button @click="connect" :disabled="loading" class="btn-primary">
              {{ loading ? 'Connecting...' : 'Connect' }}
            </button>
            <button @click="showConnectForm = false" class="btn-secondary">Cancel</button>
          </div>
        </div>
      </div>

      <div v-if="activeRepo" class="section">
        <div class="section-header">
          <h2>Status</h2>
          <select v-if="repos.length > 1" v-model="activeProvider" aria-label="Active provider">
            <option v-for="row in repos" :key="row.provider" :value="row.provider">
              {{ providerLabel(row.provider) }}
            </option>
          </select>
        </div>
        <div class="repo-connected">
          <div class="repo-info">
            <span class="status-connected">Connected · {{ providerLabel(activeRepo.provider) }}</span>
            <span class="repo-url">{{ activeRepo.repoUrl }}</span>
            <span class="repo-meta">Default branch: {{ activeRepo.defaultBranch || 'main' }}</span>
            <span v-if="activeCapabilities?.supportsReviewRequests" class="repo-meta">
              Review requests: {{ activeCapabilities.reviewRequestName }}
            </span>
            <a v-if="reviews[0]?.url" :href="reviews[0].url" target="_blank" rel="noopener" class="review-link">
              Latest review #{{ reviews[0].number }} ({{ reviews[0].state }})
            </a>
            <span v-else class="repo-meta">Latest review: branch-only (no review URL yet)</span>
          </div>
          <button @click="disconnect(activeRepo.provider)" :disabled="loading" class="btn-danger">
            Disconnect
          </button>
        </div>
      </div>

      <div v-if="activeRepo" class="section">
        <div class="section-header">
          <h2>Branches</h2>
        </div>
        <div class="inline-form">
          <input v-model="branchTicketId" type="text" placeholder="Ticket ID" />
          <button
            @click="createBranch(branchTicketId)"
            :disabled="actionLoading === 'branch' || !branchTicketId"
            class="btn-primary"
          >
            {{ actionLoading === 'branch' ? 'Creating...' : 'Create branch' }}
          </button>
        </div>
        <div v-if="branches.length === 0" class="empty-state">No branches found</div>
        <ul v-else class="branch-list">
          <li v-for="branch in branches" :key="branch.name" class="branch-item">
            <span class="branch-name">{{ branch.name }}</span>
            <button
              v-if="branch.ticketId"
              @click="deleteBranch(branch.ticketId)"
              :disabled="actionLoading === `delete-${branch.ticketId}`"
              class="btn-delete"
            >
              {{ actionLoading === `delete-${branch.ticketId}` ? 'Deleting...' : 'Delete' }}
            </button>
          </li>
        </ul>
      </div>

      <div v-if="activeRepo?.provider && activeCapabilities?.supportsReviewRequests" class="section">
        <div class="section-header">
          <h2>Reviews</h2>
        </div>
        <div class="inline-form">
          <input v-model="reviewTicketId" type="text" placeholder="Ticket ID" />
          <input v-model="reviewDescription" type="text" placeholder="Description (optional)" />
          <button
            @click="createReview(reviewTicketId, reviewDescription)"
            :disabled="actionLoading === 'review' || !reviewTicketId"
            class="btn-primary"
          >
            {{ actionLoading === 'review' ? 'Creating...' : `Create ${activeCapabilities.reviewRequestName}` }}
          </button>
        </div>
        <div v-if="reviews.length === 0" class="empty-state">No reviews found</div>
        <ul v-else class="review-list">
          <li v-for="review in reviews" :key="review.number" class="review-item">
            <a :href="review.url" target="_blank" rel="noopener" class="review-link">
              #{{ review.number }} {{ review.title || review.head || 'review' }}
            </a>
            <span :class="['review-state', review.state]">{{ review.state }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.git-connections {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.git-connections h1 {
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
  margin: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.connection-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.connection-card {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  text-align: left;
  padding: 10px 14px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
}

.connection-card.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.provider-badge {
  font-weight: 600;
  color: #1d4ed8;
}

.repo-url {
  color: #3b82f6;
  font-size: 14px;
}

.repo-meta {
  color: #6b7280;
  font-size: 13px;
}

.connect-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #374151;
}

.field input,
.field select,
.field textarea {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.form-actions, .inline-form {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.inline-form input {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.repo-connected {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
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

.empty-state {
  padding: 16px 0;
  color: #6b7280;
}

.branch-list, .review-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-item, .review-item {
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

.review-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 500;
  font-size: 14px;
}

.review-link:hover {
  text-decoration: underline;
}

.review-state {
  font-size: 12px;
  text-transform: uppercase;
  color: #6b7280;
}

.btn-primary, .btn-secondary, .btn-danger, .btn-delete {
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-secondary {
  background: white;
  border-color: #d1d5db;
  color: #374151;
}

.btn-danger, .btn-delete {
  background: #ef4444;
  color: white;
}

.btn-primary:disabled, .btn-secondary:disabled, .btn-danger:disabled, .btn-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
