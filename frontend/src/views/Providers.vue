<template>
  <div class="providers-page">
    <div class="page-header">
      <h1>AI Providers</h1>
      <VButton variant="primary" @click="showAddForm = true">Add Provider</VButton>
    </div>

    <div v-if="loading" class="loading">Loading providers...</div>

    <div v-else>
      <div v-if="error" class="error-message">{{ error }}</div>

      <div v-if="providers.length === 0 && !showAddForm" class="empty-state">
        <p>No AI providers configured.</p>
        <p class="hint">Add a provider to enable AI features for your agents.</p>
      </div>

      <div v-if="showAddForm" class="add-form">
        <h3>Add New Provider</h3>
        <div class="form-row">
          <div class="form-group">
            <label>Name</label>
            <input v-model="newProvider.name" type="text" placeholder="My OpenAI Key" />
          </div>
          <div class="form-group">
            <label>Type</label>
            <select v-model="newProvider.providerType">
              <option v-for="pt in providerTypes" :key="pt.value" :value="pt.value">
                {{ pt.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Model <span class="optional">(optional)</span></label>
            <input v-model="newProvider.model" type="text" placeholder="gpt-4o, llama3, ..." />
          </div>
          <div class="form-group">
            <label>API Key <span class="optional">(required for cloud providers)</span></label>
            <input v-model="newProvider.apiKey" type="password" placeholder="sk-..." />
          </div>
        </div>
        <div v-if="['ollama','vllm','llamacpp','custom'].includes(newProvider.providerType)" class="form-group">
          <label>Endpoint URL</label>
          <input v-model="newProvider.endpoint_url" type="text" placeholder="http://localhost:11434/v1" />
        </div>
        <div class="form-group">
          <label>Fallback Provider <span class="optional">(optional)</span></label>
          <select v-model="newProvider.fallback_provider">
            <option :value="null">(none)</option>
            <option v-for="pt in providerTypes.filter(p => p.value !== newProvider.providerType)" :key="pt.value" :value="pt.value">
              {{ pt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>
            <input v-model="newProvider.is_project_director" type="checkbox" />
            Set as default (director) provider
          </label>
        </div>
        <div class="form-actions">
          <VButton variant="primary" @click="handleAddProvider">Add</VButton>
          <VButton variant="ghost" @click="showAddForm = false">Cancel</VButton>
        </div>
      </div>

      <div v-if="providers.length > 0" class="provider-grid">
        <div v-for="provider in providers" :key="provider.id" class="provider-card" :class="{ 'director': provider.is_project_director }">
          <div class="card-header">
            <div class="card-title">
              <h3>{{ provider.name }}</h3>
              <span v-if="provider.is_project_director" class="director-badge">🎯 Director</span>
            </div>
            <span class="provider-type-badge">{{ provider.providerType }}</span>
          </div>
          <div class="card-body">
            <div v-if="provider.model" class="detail-row">
              <span class="label">Model:</span>
              <span class="value">{{ provider.model }}</span>
            </div>
            <div v-if="provider.endpoint_url" class="detail-row">
              <span class="label">Endpoint:</span>
              <span class="value">{{ provider.endpoint_url }}</span>
            </div>
            <div v-if="provider.fallback_provider" class="detail-row">
              <span class="label">Fallback:</span>
              <span class="value">{{ provider.fallback_provider }}</span>
            </div>
            <div class="detail-row">
              <span class="label">API Key:</span>
              <span class="value key-masked">{{ '••••••••••••' }}{{ provider.apiKey?.slice(-4) || '' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Status:</span>
              <span class="value" :class="provider.isActive ? 'active' : 'inactive'">
                {{ provider.isActive ? 'Active' : 'Inactive' }}
              </span>
            </div>
          </div>
          <div class="card-actions">
            <VButton variant="ghost" size="small" @click="handleSetDirector(provider.id)" :disabled="provider.is_project_director" title="Set as default">
              🎯
            </VButton>
            <VButton variant="ghost" size="small" @click="handleTestProvider(provider.id)" :disabled="testingId === provider.id">
              {{ testingId === provider.id ? 'Testing...' : 'Test' }}
            </VButton>
            <VButton variant="ghost" size="small" @click="showEditForm(provider)">Edit</VButton>
            <VButton variant="danger" size="small" @click="handleDeleteProvider(provider.id)">Delete</VButton>
          </div>
        </div>
      </div>

      <div v-if="editingProvider" class="edit-form">
        <h3>Edit Provider</h3>
        <div class="form-group">
          <label>Name</label>
          <input v-model="editProvider.name" type="text" />
        </div>
        <div class="form-group">
          <label>Model</label>
          <input v-model="editProvider.model" type="text" placeholder="gpt-4o, llama3, ..." />
        </div>
        <div class="form-group">
          <label>API Key (leave blank to keep current)</label>
          <input v-model="editProvider.apiKey" type="password" placeholder="New API key" />
        </div>
        <div v-if="['ollama','vllm','llamacpp','custom'].includes(editingProvider.providerType)" class="form-group">
          <label>Endpoint URL</label>
          <input v-model="editProvider.endpoint_url" type="text" placeholder="http://localhost:11434/v1" />
        </div>
        <div class="form-group">
          <label>Fallback Provider</label>
          <select v-model="editProvider.fallback_provider">
            <option :value="null">(none)</option>
            <option v-for="pt in providerTypes.filter(p => p.value !== editingProvider.providerType)" :key="pt.value" :value="pt.value">
              {{ pt.label }}
            </option>
          </select>
        </div>
        <div class="form-actions">
          <VButton variant="primary" @click="handleUpdateProvider">Save</VButton>
          <VButton variant="ghost" @click="editingProvider = null">Cancel</VButton>
        </div>
      </div>

      <div v-if="testResult" class="test-result" :class="(testResult.success || testResult.valid) ? 'success' : 'error'">
        <p>{{ testResult.message || ((testResult.success || testResult.valid) ? 'Connection successful!' : 'Connection failed') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { listProviders, addProvider, updateProvider, deleteProvider, testProvider, setDirector } from '@/api/providers'
import VButton from '@/components/VButton.vue'

const providers = ref([])
const loading = ref(true)
const error = ref(null)
const showAddForm = ref(false)
const editingProvider = ref(null)
const testingId = ref(null)
const testResult = ref(null)

const providerTypes = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'claude', label: 'Claude' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'llamacpp', label: 'llama.cpp' },
  { value: 'custom', label: 'Custom' },
]

const newProvider = ref({
  name: '',
  providerType: 'openai',
  model: '',
  apiKey: '',
  endpoint_url: '',
  fallback_provider: null,
  is_project_director: false,
})

const editProvider = ref({})

const loadProviders = async () => {
  loading.value = true
  error.value = null
  try {
    providers.value = await listProviders()
  } catch (e) {
    error.value = e.message || 'Failed to load providers'
  } finally {
    loading.value = false
  }
}

const handleAddProvider = async () => {
  if (!newProvider.value.name) return
  try {
    await addProvider({
      name: newProvider.value.name,
      providerType: newProvider.value.providerType,
      apiKey: newProvider.value.apiKey || undefined,
      model: newProvider.value.model || undefined,
      endpoint_url: newProvider.value.endpoint_url || undefined,
      fallback_provider: newProvider.value.fallback_provider,
      is_project_director: newProvider.value.is_project_director,
    })
    showAddForm.value = false
    newProvider.value = {
      name: '',
      providerType: 'openai',
      model: '',
      apiKey: '',
      endpoint_url: '',
      fallback_provider: null,
      is_project_director: false,
    }
    await loadProviders()
  } catch (e) {
    error.value = e.message || 'Failed to add provider'
  }
}

const showEditForm = (provider) => {
  editingProvider.value = { ...provider }
  editProvider.value = { ...provider }
}

const handleUpdateProvider = async () => {
  if (!editingProvider.value) return
  try {
    const updates = {
      name: editProvider.value.name,
      model: editProvider.value.model || undefined,
      endpoint_url: editProvider.value.endpoint_url || undefined,
      fallback_provider: editProvider.value.fallback_provider,
    }
    if (editProvider.value.apiKey) {
      updates.apiKey = editProvider.value.apiKey
    }
    await updateProvider(editingProvider.value.id, updates)
    editingProvider.value = null
    await loadProviders()
  } catch (e) {
    error.value = e.message || 'Failed to update provider'
  }
}

const handleDeleteProvider = async (id) => {
  if (!confirm('Are you sure you want to delete this provider?')) return
  try {
    await deleteProvider(id)
    await loadProviders()
  } catch (e) {
    error.value = e.message || 'Failed to delete provider'
  }
}

const handleSetDirector = async (id) => {
  try {
    await setDirector(id)
    await loadProviders()
  } catch (e) {
    error.value = e.message || 'Failed to set director'
  }
}

const handleTestProvider = async (id) => {
  testingId.value = id
  testResult.value = null
  try {
    const result = await testProvider(id)
    testResult.value = result
  } catch (e) {
    testResult.value = { success: false, valid: false, message: e.message || 'Test failed' }
  } finally {
    testingId.value = null
  }
}

onMounted(loadProviders)
</script>

<style scoped>
.providers-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0;
  font-size: var(--font-size-2xl);
}

.loading {
  text-align: center;
  padding: 40px;
  color: var(--color-text-muted);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-muted);
}

.empty-state .hint {
  font-size: var(--font-size-sm);
  margin-top: 8px;
}

.error-message {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.provider-grid {
  display: grid;
  gap: 16px;
}

.provider-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px;
  transition: box-shadow var(--transition-fast);
}

.provider-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.provider-card.director {
  border-color: var(--color-warning);
  background: var(--color-warning-bg);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title h3 {
  margin: 0;
  font-size: var(--font-size-lg);
}

.director-badge {
  background: var(--color-warning);
  color: white;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.provider-type-badge {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.card-body {
  margin-bottom: 12px;
}

.detail-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: var(--font-size-sm);
}

.detail-row .label {
  color: var(--color-text-muted);
  min-width: 80px;
}

.detail-row .value {
  color: var(--color-text);
}

.detail-row .key-masked {
  font-family: monospace;
  color: var(--color-text-muted);
}

.detail-row .value.active {
  color: var(--color-success);
}

.detail-row .value.inactive {
  color: var(--color-text-muted);
}

.card-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.add-form,
.edit-form {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 20px;
}

.add-form h3,
.edit-form h3 {
  margin-top: 0;
  margin-bottom: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-muted);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  background: var(--color-bg);
  color: var(--color-text);
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-bg);
}

.optional {
  color: var(--color-text-muted);
  font-weight: normal;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.test-result {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  margin-top: 16px;
}

.test-result.success {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.test-result.error {
  background: var(--color-error-bg);
  color: var(--color-error);
}
</style>
