<template>
  <div class="providers-page">
    <div class="page-header">
      <div>
        <h1>Model Registry</h1>
        <p class="page-subtitle">
          Provider credentials and the models the fleet may attach to a runtime.
        </p>
      </div>
      <VButton
        v-if="canManage"
        variant="primary"
        @click="showAddForm = !showAddForm"
      >
        Add credential
      </VButton>
    </div>

    <div v-if="loading" class="loading">Loading credentials...</div>

    <div v-else>
      <div v-if="error" class="error-message">{{ error }}</div>
      <div v-if="notice" class="notice">{{ notice }}</div>

      <div v-if="showAddForm && canManage" class="add-form">
        <h3>Add provider credential</h3>
        <div class="form-row">
          <div class="form-group">
            <label for="credential-name">Name</label>
            <input
              id="credential-name"
              v-model="newCredential.name"
              type="text"
              placeholder="Acme production"
            />
          </div>
          <div class="form-group">
            <label for="credential-type">Provider type</label>
            <select id="credential-type" v-model="newCredential.providerType">
              <option v-for="pt in providerTypes" :key="pt.value" :value="pt.value">
                {{ pt.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="credential-key">
              API key <span class="optional">(stored encrypted, never shown again)</span>
            </label>
            <input
              id="credential-key"
              v-model="newCredential.apiKey"
              type="password"
              placeholder="sk-..."
              autocomplete="new-password"
            />
          </div>
          <div class="form-group">
            <label for="credential-base-url">Base URL <span class="optional">(optional)</span></label>
            <input
              id="credential-base-url"
              v-model="newCredential.baseUrl"
              type="text"
              placeholder="https://api.example.com/v1"
            />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="credential-project">
              Project scope <span class="optional">(optional; blank = owner-global)</span>
            </label>
            <input
              id="credential-project"
              v-model="newCredential.projectId"
              type="text"
              placeholder="Project ID"
            />
          </div>
        </div>
        <div class="form-actions">
          <VButton
            variant="primary"
            :loading="savingCredential"
            :disabled="!newCredential.name.trim() || !newCredential.apiKey.trim()"
            @click="handleAddCredential"
          >
            Add credential
          </VButton>
          <VButton variant="ghost" @click="showAddForm = false">Cancel</VButton>
        </div>
      </div>

      <div v-if="credentials.length === 0 && !showAddForm" class="empty-state">
        <p>No provider credentials configured.</p>
        <p class="hint">
          Add a credential, discover its models, and verify the models before a runtime can attach them.
        </p>
      </div>

      <div class="credential-list">
        <section
          v-for="credential in credentials"
          :key="credential.id"
          class="credential-card"
        >
          <div class="card-header">
            <div class="card-title">
              <h2>{{ credential.name }}</h2>
              <span class="provider-type-badge">{{ credential.provider_type }}</span>
              <span :class="['status-badge', `credential-${credential.status}`]">
                {{ credential.status }}
              </span>
            </div>
            <div v-if="canManage" class="card-actions">
              <VButton
                variant="ghost"
                size="small"
                @click="startEditCredential(credential)"
              >
                Edit
              </VButton>
              <VButton
                variant="ghost"
                size="small"
                :loading="discoveringId === String(credential.id)"
                @click="handleDiscover(credential)"
              >
                Discover
              </VButton>
              <VButton
                variant="ghost"
                size="small"
                @click="startAddModel(credential)"
              >
                Add model
              </VButton>
              <VButton
                variant="danger"
                size="small"
                :loading="deletingId === String(credential.id)"
                @click="handleDeleteCredential(credential)"
              >
                Delete
              </VButton>
            </div>
          </div>

          <div class="card-body">
            <div class="detail-row">
              <span class="label">Credential:</span>
              <span class="value key-masked">{{ maskedCredential(credential) }}</span>
            </div>
            <div v-if="credential.base_url" class="detail-row">
              <span class="label">Base URL:</span>
              <span class="value">{{ credential.base_url }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Version:</span>
              <span class="value">{{ credential.version }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Scope:</span>
              <span class="value">
                {{ credential.project_id ? `Project ${credential.project_id}` : 'Owner-global' }}
              </span>
            </div>
          </div>

          <div
            v-if="editingCredentialId === String(credential.id) && canManage"
            class="edit-form"
          >
            <h3>Edit credential</h3>
            <div class="form-row">
              <div class="form-group">
                <label :for="`edit-credential-name-${credential.id}`">Name</label>
                <input
                  :id="`edit-credential-name-${credential.id}`"
                  v-model="editCredential.name"
                  type="text"
                  disabled
                />
              </div>
              <div class="form-group">
                <label :for="`edit-credential-status-${credential.id}`">Status</label>
                <select
                  :id="`edit-credential-status-${credential.id}`"
                  v-model="editCredential.status"
                >
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label :for="`edit-credential-key-${credential.id}`">
                  Rotate API key <span class="optional">(leave blank to keep the current key)</span>
                </label>
                <input
                  :id="`edit-credential-key-${credential.id}`"
                  v-model="editCredential.apiKey"
                  type="password"
                  placeholder="New API key"
                  autocomplete="new-password"
                />
              </div>
              <div class="form-group">
                <label :for="`edit-credential-url-${credential.id}`">Base URL</label>
                <input
                  :id="`edit-credential-url-${credential.id}`"
                  v-model="editCredential.baseUrl"
                  type="text"
                />
              </div>
            </div>
            <div class="form-actions">
              <VButton
                variant="primary"
                :loading="savingCredential"
                @click="handleUpdateCredential(credential)"
              >
                Save credential
              </VButton>
              <VButton variant="ghost" @click="editingCredentialId = null">Cancel</VButton>
            </div>
          </div>

          <div
            v-if="deleteConflict && deleteConflict.credentialId === String(credential.id)"
            class="delete-conflict"
            role="alert"
          >
            <p class="delete-conflict-title">Cannot delete this credential.</p>
            <p>{{ deleteConflict.message }}</p>
            <p v-if="deleteConflict.runtimes.length > 0">
              Referenced runtimes: {{ deleteConflict.runtimes.join(', ') }}
            </p>
            <p v-if="deleteConflict.models.length > 0">
              Referenced models: {{ deleteConflict.models.join(', ') }}
            </p>
            <p class="hint">Detach the references, or disable the credential instead.</p>
          </div>

          <div class="models-section">
            <div class="section-header">
              <h3>Models</h3>
              <span class="count">{{ modelsFor(credential).length }}</span>
            </div>

            <table v-if="modelsFor(credential).length > 0" class="model-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Source</th>
                  <th>Roles</th>
                  <th>Effort</th>
                  <th>Verified</th>
                  <th v-if="canManage">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in modelsFor(credential)" :key="model.id">
                  <td>
                    <span :class="['model-status', `model-status-${model.status}`]">
                      {{ model.status }}
                    </span>
                  </td>
                  <td>
                    <span class="model-name">{{ model.display_name || model.model }}</span>
                    <div v-if="model.display_name" class="model-id">{{ model.model }}</div>
                  </td>
                  <td>{{ model.source }}</td>
                  <td>
                    <span v-for="role in model.roles" :key="role" class="role-tag">
                      {{ role }}
                    </span>
                    <span v-if="model.roles.length === 0" class="none">—</span>
                  </td>
                  <td><span class="effort-tag">{{ model.effort }}</span></td>
                  <td>
                    <span v-if="model.last_verified_at">{{ formatDate(model.last_verified_at) }}</span>
                    <span v-else class="none">Never</span>
                    <div v-if="model.last_verify_error" class="verify-error">
                      {{ model.last_verify_error }}
                    </div>
                  </td>
                  <td v-if="canManage" class="model-actions">
                    <VButton
                      variant="ghost"
                      size="small"
                      :loading="testingId === String(model.id)"
                      @click="handleTestModel(model)"
                    >
                      Test
                    </VButton>
                    <VButton
                      variant="ghost"
                      size="small"
                      @click="startEditModel(model)"
                    >
                      Edit
                    </VButton>
                    <VButton
                      variant="ghost"
                      size="small"
                      @click="handleToggleModel(model)"
                    >
                      {{ model.status === 'disabled' ? 'Enable' : 'Disable' }}
                    </VButton>
                    <div
                      v-if="testResults[String(model.id)]"
                      :class="[
                        'model-test-result',
                        testResults[String(model.id)].verified ? 'success' : 'error',
                      ]"
                    >
                      <template v-if="testResults[String(model.id)].verified">
                        <template v-if="testResults[String(model.id)].latencyMs != null">
                          Verified in {{ testResults[String(model.id)].latencyMs }} ms
                        </template>
                        <template v-else>Verified</template>
                      </template>
                      <template v-else>
                        {{ testResults[String(model.id)].error || 'Verification failed' }}
                      </template>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="empty-inline">
              No models yet. Discover the provider or add a model manually.
            </p>

            <div
              v-if="editingModel && String(editingModel.credential_id) === String(credential.id) && canManage"
              class="model-edit-form"
            >
              <h4>Edit model {{ editingModel.model }}</h4>
              <div class="form-row">
                <fieldset class="form-group role-fieldset">
                  <legend>Roles</legend>
                  <label v-for="role in ROLE_OPTIONS" :key="role" class="role-checkbox">
                    <input v-model="editModel.roles" type="checkbox" :value="role" />
                    {{ role }}
                  </label>
                </fieldset>
                <div class="form-group">
                  <label :for="`edit-model-effort-${editingModel.id}`">Effort</label>
                  <select :id="`edit-model-effort-${editingModel.id}`" v-model="editModel.effort">
                    <option v-for="effort in EFFORT_OPTIONS" :key="effort" :value="effort">
                      {{ effort }}
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label :for="`edit-model-max-${editingModel.id}`">Max tokens</label>
                  <input
                    :id="`edit-model-max-${editingModel.id}`"
                    v-model="editModel.maxTokens"
                    type="number"
                    min="1"
                  />
                </div>
              </div>
              <div class="form-actions">
                <VButton variant="primary" :loading="savingModel" @click="handleSaveModel">
                  Save model
                </VButton>
                <VButton variant="ghost" @click="editingModel = null">Cancel</VButton>
              </div>
            </div>

            <div
              v-if="addingModelCredentialId === String(credential.id) && canManage"
              class="model-form"
            >
              <h4>Add model manually</h4>
              <div class="form-row">
                <div class="form-group">
                  <label :for="`new-model-id-${credential.id}`">Model ID</label>
                  <input
                    :id="`new-model-id-${credential.id}`"
                    v-model="newModel.model"
                    type="text"
                    placeholder="gpt-4o, claude-sonnet, ..."
                  />
                </div>
                <div class="form-group">
                  <label :for="`new-model-name-${credential.id}`">
                    Display name <span class="optional">(optional)</span>
                  </label>
                  <input
                    :id="`new-model-name-${credential.id}`"
                    v-model="newModel.displayName"
                    type="text"
                  />
                </div>
              </div>
              <div class="form-row">
                <fieldset class="form-group role-fieldset">
                  <legend>Roles</legend>
                  <label v-for="role in ROLE_OPTIONS" :key="role" class="role-checkbox">
                    <input v-model="newModel.roles" type="checkbox" :value="role" />
                    {{ role }}
                  </label>
                </fieldset>
                <div class="form-group">
                  <label :for="`new-model-effort-${credential.id}`">Effort</label>
                  <select :id="`new-model-effort-${credential.id}`" v-model="newModel.effort">
                    <option v-for="effort in EFFORT_OPTIONS" :key="effort" :value="effort">
                      {{ effort }}
                    </option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label :for="`new-model-max-${credential.id}`">
                    Max tokens <span class="optional">(optional)</span>
                  </label>
                  <input
                    :id="`new-model-max-${credential.id}`"
                    v-model="newModel.maxTokens"
                    type="number"
                    min="1"
                  />
                </div>
                <div class="form-group">
                  <label :for="`new-model-context-${credential.id}`">
                    Context window <span class="optional">(optional)</span>
                  </label>
                  <input
                    :id="`new-model-context-${credential.id}`"
                    v-model="newModel.contextWindow"
                    type="number"
                    min="1"
                  />
                </div>
              </div>
              <div class="form-actions">
                <VButton
                  variant="primary"
                  :loading="savingModel"
                  :disabled="!newModel.model.trim()"
                  @click="handleAddModel(credential)"
                >
                  Add model
                </VButton>
                <VButton variant="ghost" @click="addingModelCredentialId = null">
                  Cancel
                </VButton>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  addModel,
  createCredential,
  deleteCredential,
  discoverModels,
  listCredentialModels,
  listCredentials,
  testModel,
  updateCredential,
  updateModel,
  type CreateCredentialInput,
  type ProviderCredential,
  type ProviderCredentialStatus,
  type ProviderModel,
  type ProviderModelStatus,
  type ProviderModelTestResult,
  type UpdateCredentialInput,
  type UpdateModelInput,
} from '@/api/providerRegistry'
import type {
  AgentRuntimeRole,
  ReasoningEffort,
} from '@/api/agentNodes'
import { useAuthStore } from '@/stores/auth'
import VButton from '@/components/VButton.vue'

interface DeleteConflict {
  credentialId: string
  message: string
  runtimes: string[]
  models: string[]
}

interface EditableCredential {
  name: string
  apiKey: string
  baseUrl: string
  status: ProviderCredentialStatus
}

interface EditableModel {
  roles: AgentRuntimeRole[]
  effort: ReasoningEffort
  maxTokens: number | string
}

interface NewModelForm {
  model: string
  displayName: string
  roles: AgentRuntimeRole[]
  effort: ReasoningEffort
  maxTokens: number | string
  contextWindow: number | string
}

const authStore = useAuthStore()

const BASE_PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'opencode', label: 'OpenCode (Zen)' },
  { value: 'opencode-go', label: 'OpenCode Go' },
  { value: 'claude', label: 'Claude' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'llamacpp', label: 'llama.cpp' },
  { value: 'custom', label: 'Custom' },
]

const ROLE_OPTIONS: AgentRuntimeRole[] = ['worker', 'reviewer', 'planner']
const EFFORT_OPTIONS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'max']

const providerTypes = computed(() => BASE_PROVIDER_TYPES)
const canManage = computed(() => authStore.hasAnyPermission(['PROJECT_MANAGE_MEMBERS']))

const credentials = ref<ProviderCredential[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')
const showAddForm = ref(false)
const savingCredential = ref(false)
const deletingId = ref('')
const discoveringId = ref('')
const testingId = ref('')
const savingModel = ref(false)
const deleteConflict = ref<DeleteConflict | null>(null)
const testResults = ref<Record<string, ProviderModelTestResult>>({})

const newCredential = ref({
  name: '',
  providerType: 'openai',
  apiKey: '',
  baseUrl: '',
  projectId: '',
})

const editingCredentialId = ref<string | null>(null)
const editCredential = ref<EditableCredential>({
  name: '',
  apiKey: '',
  baseUrl: '',
  status: 'active',
})

const addingModelCredentialId = ref<string | null>(null)
const newModel = ref<NewModelForm>({
  model: '',
  displayName: '',
  roles: [],
  effort: 'medium',
  maxTokens: '',
  contextWindow: '',
})

const editingModel = ref<ProviderModel | null>(null)
const editModel = ref<EditableModel>({
  roles: [],
  effort: 'medium',
  maxTokens: '',
})

function maskedCredential(credential: ProviderCredential): string {
  return credential.api_key_masked || '••••••••'
}

function modelsFor(credential: ProviderCredential): ProviderModel[] {
  return credential.models ?? []
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function parseInteger(value: string | number): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function referenceLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item: unknown) => {
      if (item === null || item === undefined) return ''
      if (typeof item === 'string' || typeof item === 'number') return String(item)
      if (typeof item === 'object') {
        const record = item as { name?: unknown; model?: unknown; id?: unknown }
        return String(record.name ?? record.model ?? record.id ?? '')
      }
      return String(item)
    })
    .filter(Boolean)
}

function conflictReferences(err: unknown): { runtimes: string[]; models: string[] } {
  const error = err as {
    referencingRuntimes?: unknown
    referencingModels?: unknown
    details?: { referencingRuntimes?: unknown; referencingModels?: unknown }
  }
  return {
    runtimes: referenceLabels(error.referencingRuntimes ?? error.details?.referencingRuntimes),
    models: referenceLabels(error.referencingModels ?? error.details?.referencingModels),
  }
}

async function loadCredentials(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const rows = (await listCredentials()) || []
    credentials.value = await Promise.all(rows.map(async (credential) => ({
      ...credential,
      models: await listCredentialModels(credential.id).catch(() => credential.models ?? []),
    })))
  } catch (err) {
    error.value = (err as Error).message || 'Failed to load credentials'
  } finally {
    loading.value = false
  }
}

async function handleAddCredential(): Promise<void> {
  if (!newCredential.value.name.trim() || !newCredential.value.apiKey.trim()) return
  savingCredential.value = true
  error.value = ''
  notice.value = ''
  try {
    const payload: CreateCredentialInput = {
      name: newCredential.value.name.trim(),
      providerType: newCredential.value.providerType,
      apiKey: newCredential.value.apiKey.trim(),
      baseUrl: newCredential.value.baseUrl.trim() || undefined,
      projectId: newCredential.value.projectId.trim() || undefined,
    }
    await createCredential(payload)
    showAddForm.value = false
    newCredential.value = {
      name: '',
      providerType: 'openai',
      apiKey: '',
      baseUrl: '',
      projectId: '',
    }
    notice.value = 'Credential added. Discover or add models to make it usable.'
    await loadCredentials()
  } catch (err) {
    error.value = (err as Error).message || 'Failed to add the credential'
  } finally {
    savingCredential.value = false
  }
}

function startEditCredential(credential: ProviderCredential): void {
  editingCredentialId.value = String(credential.id)
  editCredential.value = {
    name: credential.name,
    apiKey: '',
    baseUrl: credential.base_url ?? '',
    status: credential.status,
  }
}

async function handleUpdateCredential(credential: ProviderCredential): Promise<void> {
  savingCredential.value = true
  error.value = ''
  notice.value = ''
  try {
    const updates: UpdateCredentialInput = {
      baseUrl: editCredential.value.baseUrl.trim(),
      status: editCredential.value.status,
    }
    if (editCredential.value.apiKey.trim()) {
      updates.apiKey = editCredential.value.apiKey.trim()
    }
    await updateCredential(credential.id, updates)
    editingCredentialId.value = null
    notice.value = updates.apiKey
      ? 'Credential updated and the key rotated.'
      : 'Credential updated.'
    await loadCredentials()
  } catch (err) {
    error.value = (err as Error).message || 'Failed to update the credential'
  } finally {
    savingCredential.value = false
  }
}

async function handleDeleteCredential(credential: ProviderCredential): Promise<void> {
  if (!confirm(`Delete credential "${credential.name}"?`)) return
  deletingId.value = String(credential.id)
  deleteConflict.value = null
  error.value = ''
  notice.value = ''
  try {
    await deleteCredential(credential.id)
    notice.value = 'Credential deleted.'
    await loadCredentials()
  } catch (err) {
    const errorWithStatus = err as { status?: number }
    if (errorWithStatus.status === 409) {
      const references = conflictReferences(err)
      deleteConflict.value = {
        credentialId: String(credential.id),
        message: (err as Error).message || 'The credential is still referenced.',
        runtimes: references.runtimes,
        models: references.models,
      }
    } else {
      error.value = (err as Error).message || 'Failed to delete the credential'
    }
  } finally {
    deletingId.value = ''
  }
}

async function handleDiscover(credential: ProviderCredential): Promise<void> {
  discoveringId.value = String(credential.id)
  error.value = ''
  notice.value = ''
  try {
    const discovered = await discoverModels(credential.id)
    const count = Array.isArray(discovered) ? discovered.length : 0
    notice.value = `Discovery finished: ${count} model${count === 1 ? '' : 's'} found (unverified).`
    await loadCredentials()
  } catch (err) {
    error.value = (err as Error).message || 'Model discovery failed'
  } finally {
    discoveringId.value = ''
  }
}

function startAddModel(credential: ProviderCredential): void {
  addingModelCredentialId.value = String(credential.id)
  newModel.value = {
    model: '',
    displayName: '',
    roles: [],
    effort: 'medium',
    maxTokens: '',
    contextWindow: '',
  }
}

async function handleAddModel(credential: ProviderCredential): Promise<void> {
  if (!newModel.value.model.trim()) return
  savingModel.value = true
  error.value = ''
  notice.value = ''
  try {
    await addModel(credential.id, {
      model: newModel.value.model.trim(),
      displayName: newModel.value.displayName.trim() || undefined,
      roles: [...newModel.value.roles],
      effort: newModel.value.effort,
      maxTokens: parseInteger(newModel.value.maxTokens),
      contextWindow: parseInteger(newModel.value.contextWindow),
    })
    addingModelCredentialId.value = null
    notice.value = 'Model added. Test it before a runtime can attach it.'
    await loadCredentials()
  } catch (err) {
    error.value = (err as Error).message || 'Failed to add the model'
  } finally {
    savingModel.value = false
  }
}

function startEditModel(model: ProviderModel): void {
  editingModel.value = model
  editModel.value = {
    roles: [...model.roles],
    effort: model.effort,
    maxTokens: model.max_tokens === null ? '' : String(model.max_tokens),
  }
}

async function handleSaveModel(): Promise<void> {
  const model = editingModel.value
  if (!model) return
  savingModel.value = true
  error.value = ''
  notice.value = ''
  try {
    const updates: UpdateModelInput = {
      roles: [...editModel.value.roles],
      effort: editModel.value.effort,
      maxTokens: parseInteger(editModel.value.maxTokens) ?? null,
    }
    await updateModel(model.id, updates)
    editingModel.value = null
    notice.value = 'Model updated.'
    await loadCredentials()
  } catch (err) {
    error.value = (err as Error).message || 'Failed to update the model'
  } finally {
    savingModel.value = false
  }
}

async function handleToggleModel(model: ProviderModel): Promise<void> {
  const nextStatus: ProviderModelStatus =
    model.status === 'disabled'
      ? model.last_verified_at
        ? 'verified'
        : 'unverified'
      : 'disabled'
  error.value = ''
  notice.value = ''
  try {
    await updateModel(model.id, { status: nextStatus })
    notice.value = `Model ${nextStatus}.`
    await loadCredentials()
  } catch (err) {
    error.value = (err as Error).message || 'Failed to change the model status'
  }
}

async function handleTestModel(model: ProviderModel): Promise<void> {
  const key = String(model.id)
  testingId.value = key
  error.value = ''
  notice.value = ''
  try {
    const result = await testModel(model.id)
    testResults.value = { ...testResults.value, [key]: result }
    await loadCredentials()
  } catch (err) {
    testResults.value = {
      ...testResults.value,
      [key]: { verified: false, latencyMs: 0, error: (err as Error).message || 'Verification failed' },
    }
  } finally {
    testingId.value = ''
  }
}

onMounted(() => {
  loadCredentials()
})
</script>

<style scoped>
.providers-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.page-header h1 {
  margin: 0 0 4px;
  font-size: var(--font-size-2xl);
}

.page-subtitle {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
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

.notice {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.credential-list {
  display: grid;
  gap: 16px;
}

.credential-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px;
  transition: box-shadow var(--transition-fast);
}

.credential-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-title h2 {
  margin: 0;
  font-size: var(--font-size-lg);
}

.card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.provider-type-badge {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.status-badge,
.model-status,
.role-tag,
.effort-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: var(--font-size-sm);
  font-weight: 500;
  line-height: 1.5;
}

.credential-active {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.credential-disabled {
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
}

.model-status-verified {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.model-status-unverified {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.model-status-disabled {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.role-tag {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  margin: 0 4px 2px 0;
}

.effort-tag {
  background: var(--color-bg-secondary);
  color: var(--color-text);
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
  min-width: 90px;
}

.detail-row .value {
  color: var(--color-text);
}

.key-masked {
  font-family: monospace;
  color: var(--color-text-muted);
}

.add-form,
.edit-form,
.model-form,
.model-edit-form {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 20px;
}

.add-form h3,
.edit-form h3,
.model-form h4,
.model-edit-form h4 {
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
  margin-bottom: 8px;
  min-width: 0;
}

.form-group label,
.form-group legend {
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

.role-fieldset {
  border: none;
  padding: 0;
  margin: 0;
}

.role-checkbox {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  margin-right: 12px;
  color: var(--color-text) !important;
  font-weight: normal !important;
}

.role-checkbox input {
  width: auto;
}

.optional {
  color: var(--color-text-muted);
  font-weight: normal;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.models-section {
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.section-header h3 {
  margin: 0;
  font-size: var(--font-size-base);
}

.count {
  padding: 1px 8px;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
  border-radius: 10px;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.model-table {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

.model-table th,
.model-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  vertical-align: top;
  white-space: nowrap;
}

.model-table th {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.model-name {
  font-weight: 600;
}

.model-id {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-muted);
}

.model-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.verify-error {
  color: var(--color-error);
  font-size: 12px;
  margin-top: 2px;
  white-space: normal;
}

.model-test-result {
  width: 100%;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  margin-top: 4px;
  white-space: normal;
}

.model-test-result.success {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.model-test-result.error {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.delete-conflict {
  background: var(--color-error-bg);
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 12px;
  font-size: var(--font-size-sm);
}

.delete-conflict p {
  margin: 0 0 4px;
}

.delete-conflict .delete-conflict-title {
  font-weight: 600;
}

.delete-conflict .hint {
  color: var(--color-text-muted);
}

.empty-inline {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin: 8px 0;
}

.none {
  color: var(--color-text-muted);
}

@media (max-width: 640px) {
  .providers-page {
    padding: 12px;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .card-header {
    flex-direction: column;
  }
}
</style>
