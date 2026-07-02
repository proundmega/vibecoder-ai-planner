<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '@/api/templates'

const route = useRoute()
const projectId = route.params.id

const templatesLoading = ref(true)
const templatesError = ref(null)
const templatesData = ref([])
const showCreateModal = ref(false)
const showEditModal = ref(false)
const createActionLoading = ref(false)
const updateActionLoading = ref(null)
const deleteActionLoading = ref(null)

const newName = ref('')
const newDescription = ref('')
const newFiles = ref([{ key: '', content: '' }])

const editingTemplate = ref(null)
const editName = ref('')
const editDescription = ref('')
const editFiles = ref([{ key: '', content: '' }])

const createSuccess = ref(null)

onMounted(async () => {
  templatesLoading.value = true
  try {
    templatesData.value = await listTemplates(projectId)
  } catch (err) {
    console.error('Failed to load templates:', err)
    templatesError.value = 'Failed to load templates'
  } finally {
    templatesLoading.value = false
  }
})

async function handleCreateTemplate() {
  if (!newName.value.trim()) return
  const validFiles = newFiles.value.filter(f => f.key.trim())
  if (validFiles.length === 0) return

  createActionLoading.value = true
  createSuccess.value = null
  try {
    await createTemplate(projectId, {
      name: newName.value.trim(),
      description: newDescription.value.trim() || null,
      file_definitions: validFiles.map(f => ({ key: f.key.trim(), content: f.content })),
    })
    templatesData.value = await listTemplates(projectId)
    showCreateModal.value = false
    newName.value = ''
    newDescription.value = ''
    newFiles.value = [{ key: '', content: '' }]
    createSuccess.value = 'Template created successfully'
  } catch (err) {
    templatesError.value = err.message || 'Failed to create template'
  } finally {
    createActionLoading.value = false
  }
}

async function handleDeleteTemplate(id) {
  deleteActionLoading.value = id
  try {
    await deleteTemplate(projectId, id)
    templatesData.value = templatesData.value.filter(t => t.id !== id)
  } catch (err) {
    templatesError.value = err.message || 'Failed to delete template'
  } finally {
    deleteActionLoading.value = null
  }
}

function handleEditTemplate(template) {
  editingTemplate.value = template
  editName.value = template.name
  editDescription.value = template.description || ''
  editFiles.value = template.file_definitions && template.file_definitions.length > 0 
    ? template.file_definitions.map(f => ({ key: f.key || '', content: f.content || '' }))
    : [{ key: '', content: '' }]
  showEditModal.value = true
}

async function handleUpdateTemplate() {
  if (!editName.value.trim()) return
  const validFiles = editFiles.value.filter(f => f.key.trim())
  if (validFiles.length === 0) return

  updateActionLoading.value = editingTemplate.value.id
  try {
    await updateTemplate(projectId, editingTemplate.value.id, {
      name: editName.value.trim(),
      description: editDescription.value.trim() || null,
      file_definitions: validFiles.map(f => ({ key: f.key.trim(), content: f.content })),
    })
    templatesData.value = await listTemplates(projectId)
    showEditModal.value = false
    editingTemplate.value = null
    editName.value = ''
    editDescription.value = ''
    editFiles.value = [{ key: '', content: '' }]
  } catch (err) {
    templatesError.value = err.message || 'Failed to update template'
  } finally {
    updateActionLoading.value = null
  }
}

function addFileRow() {
  newFiles.value.push({ key: '', content: '' })
}

function removeFileRow(index) {
  if (newFiles.value.length > 1) {
    newFiles.value.splice(index, 1)
  }
}

function addEditFileRow() {
  editFiles.value.push({ key: '', content: '' })
}

function removeEditFileRow(index) {
  if (editFiles.value.length > 1) {
    editFiles.value.splice(index, 1)
  }
}
</script>

<template>
  <div class="project-templates">
    <div v-if="templatesLoading" class="loading">Loading templates...</div>
    <div v-else-if="templatesError" class="error">
      <p>{{ templatesError }}</p>
    </div>
    <div v-else>
      <h1>Custom Templates</h1>
      <p class="subtitle">Manage custom document templates for your project</p>

      <div v-if="createSuccess" class="success">{{ createSuccess }}</div>

      <div class="section-header">
        <h2>Templates</h2>
        <button @click="showCreateModal = true" class="btn-primary">Create Template</button>
      </div>

      <div v-if="templatesData.length === 0" class="empty-state">
        <p>No custom templates yet</p>
        <button @click="showCreateModal = true" class="btn-primary">Create Your First Template</button>
      </div>

      <div v-else class="templates-list">
        <div v-for="template in templatesData" :key="template.id" class="template-card">
          <div class="template-info">
            <h3>{{ template.name }}</h3>
            <p v-if="template.description" class="template-description">{{ template.description }}</p>
            <div class="template-meta">
              <span>{{ template.file_definitions_count || 0 }} files</span>
              <span>by {{ template.created_by_name || 'Unknown' }}</span>
              <span>{{ new Date(template.created_at).toLocaleDateString() }}</span>
            </div>
          </div>
          <div class="template-actions">
            <button
              @click="handleEditTemplate(template)"
              :disabled="updateActionLoading === template.id"
              class="btn-edit"
            >
              {{ updateActionLoading === template.id ? 'Saving...' : 'Edit' }}
            </button>
            <button
              @click="handleDeleteTemplate(template.id)"
              :disabled="deleteActionLoading === template.id"
              class="btn-delete"
            >
              {{ deleteActionLoading === template.id ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="modal" @click.self="showCreateModal = false">
      <div class="modal-content">
        <h3>Create Custom Template</h3>

        <div class="form-group">
          <label>Template Name</label>
          <input v-model="newName" type="text" placeholder="e.g., Sprint Planning" class="input" />
        </div>

        <div class="form-group">
          <label>Description (optional)</label>
          <input v-model="newDescription" type="text" placeholder="What is this template for?" class="input" />
        </div>

        <div class="form-group">
          <label>Files</label>
          <div v-for="(file, index) in newFiles" :key="index" class="file-row">
            <input v-model="file.key" type="text" placeholder="File name (e.g., 01_REQUIREMENT.md)" class="input file-key" />
            <textarea v-model="file.content" placeholder="Template content..." class="textarea file-content" rows="3" />
            <button @click="removeFileRow(index)" class="btn-remove" :disabled="newFiles.length === 1">
              Remove
            </button>
          </div>
          <button @click="addFileRow" class="btn-add-file">+ Add File</button>
        </div>

        <div class="form-actions">
          <button @click="handleCreateTemplate" :disabled="createActionLoading" class="btn-primary">
            {{ createActionLoading ? 'Creating...' : 'Create Template' }}
          </button>
          <button @click="showCreateModal = false" class="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="modal" @click.self="showEditModal = false">
      <div class="modal-content">
        <h3>Edit Template</h3>

        <div class="form-group">
          <label>Template Name</label>
          <input v-model="editName" type="text" placeholder="e.g., Sprint Planning" class="input" />
        </div>

        <div class="form-group">
          <label>Description (optional)</label>
          <input v-model="editDescription" type="text" placeholder="What is this template for?" class="input" />
        </div>

        <div class="form-group">
          <label>Files</label>
          <div v-for="(file, index) in editFiles" :key="index" class="file-row">
            <input v-model="file.key" type="text" placeholder="File name (e.g., 01_REQUIREMENT.md)" class="input file-key" />
            <textarea v-model="file.content" placeholder="Template content..." class="textarea file-content" rows="3" />
            <button @click="removeEditFileRow(index)" class="btn-remove" :disabled="editFiles.length === 1">
              Remove
            </button>
          </div>
          <button @click="addEditFileRow" class="btn-add-file">+ Add File</button>
        </div>

        <div class="form-actions">
          <button @click="handleUpdateTemplate" :disabled="updateActionLoading === editingTemplate?.id" class="btn-primary">
            {{ updateActionLoading === editingTemplate?.id ? 'Saving...' : 'Save Changes' }}
          </button>
          <button @click="showEditModal = false" class="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-templates {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.project-templates h1 {
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

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h2 {
  font-size: 20px;
  color: #1f2937;
  margin: 0;
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
  margin: 0 0 16px 0;
}

.templates-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.template-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.template-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.template-info h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  color: #1f2937;
}

.template-description {
  color: #6b7280;
  font-size: 14px;
  margin: 0 0 8px 0;
}

.template-meta {
  display: flex;
  gap: 16px;
  color: #9ca3af;
  font-size: 13px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.input,
.textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.textarea {
  resize: vertical;
  font-family: monospace;
}

.file-row {
  margin-bottom: 12px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.file-key {
  margin-bottom: 8px;
}

.btn-remove {
  margin-top: 8px;
  padding: 6px 12px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.btn-remove:hover:not(:disabled) {
  background: #fecaca;
}

.btn-remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-add-file {
  padding: 8px 16px;
  background: white;
  color: #3b82f6;
  border: 1px dashed #3b82f6;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-add-file:hover {
  background: #eff6ff;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
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

.btn-edit {
  padding: 8px 16px;
  background: #dbeafe;
  color: #2563eb;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
}

.btn-edit:hover:not(:disabled) {
  background: #bfdbfe;
}

.btn-edit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-delete {
  padding: 8px 16px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
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
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h3 {
  margin: 0 0 20px 0;
  font-size: 18px;
  color: #1f2937;
}
</style>
