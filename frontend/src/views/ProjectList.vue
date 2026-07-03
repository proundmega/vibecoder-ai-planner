<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchProjects, createProject, updateProject, deleteProject } from '@/api/projects'

const router = useRouter()
const projects = ref([])
const loading = ref(true)
const error = ref(null)
const createError = ref(null)
const editError = ref(null)

const showCreateModal = ref(false)
const projectName = ref('')
const projectDesc = ref('')
const creating = ref(false)

const editingProject = ref(null)
const editName = ref('')
const editDesc = ref('')
const showEditModal = ref(false)
const updating = ref(false)

const deletingProject = ref(null)
const showDeleteModal = ref(false)
const deleting = ref(false)

onMounted(async () => {
  try {
    projects.value = await fetchProjects()
  } catch (err) {
    console.error('Failed to load projects:', err)
    error.value = 'Failed to load projects'
  } finally {
    loading.value = false
  }
})

async function handleCreate() {
  if (!projectName.value.trim()) return
  creating.value = true
  try {
    const project = await createProject(projectName.value.trim(), projectDesc.value.trim())
    if (project) {
      projects.value.unshift(project)
      showCreateModal.value = false
      projectName.value = ''
      projectDesc.value = ''
      router.push(`/projects/${project.id}/tickets`)
    }
  } catch (err) {
    console.error('Failed to create project:', err)
    createError.value = 'Failed to create project'
  } finally {
    creating.value = false
  }
}

function openEditModal(project) {
  editingProject.value = project
  editName.value = project.name
  editDesc.value = project.description || ''
  showEditModal.value = true
}

async function handleEdit() {
  if (!editName.value.trim() || !editingProject.value) return
  updating.value = true
  try {
    const updated = await updateProject(editingProject.value.id, editName.value.trim(), editDesc.value.trim())
    if (updated) {
      const idx = projects.value.findIndex(p => p.id === editingProject.value.id)
      if (idx !== -1) {
        projects.value[idx] = updated
      }
      showEditModal.value = false
      editingProject.value = null
    }
  } catch (err) {
    console.error('Failed to update project:', err)
    editError.value = 'Failed to update project'
  } finally {
    updating.value = false
  }
}

function openDeleteModal(project) {
  deletingProject.value = project
  showDeleteModal.value = true
}

async function handleDelete() {
  if (!deletingProject.value) return
  deleting.value = true
  try {
    const result = await deleteProject(deletingProject.value.id)
    if (!result.error) {
      projects.value = projects.value.filter(p => p.id !== deletingProject.value.id)
      showDeleteModal.value = false
      deletingProject.value = null
    } else {
      editError.value = result.error || 'Failed to delete project'
    }
  } catch (err) {
    console.error('Failed to delete project:', err)
    editError.value = 'Failed to delete project'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="project-list">
    <div class="page-header">
      <h1>My Projects</h1>
      <button @click="showCreateModal = true" class="btn-create">+ New Project</button>
    </div>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="router.go(-1)">Go Back</button>
    </div>

    <div v-else-if="projects.length === 0" class="empty">
      <p>No projects yet. Start by creating one!</p>
      <button @click="showCreateModal = true" class="btn-create">+ New Project</button>
    </div>

    <div v-else>
      <div v-if="createError || editError" class="error-inline">
        <p>{{ createError || editError }}</p>
        <button @click="createError = null; editError = null">Dismiss</button>
      </div>
      <div class="projects-grid">
         <div v-for="project in projects" :key="project.id" class="project-card">
           <router-link :to="`/projects/${project.id}/tickets`" class="card-main">
             <div class="project-info">
               <h3>{{ project.name }}</h3>
               <p v-if="project.description">{{ project.description }}</p>
               <p v-else class="no-desc">No description</p>
             </div>
             <div class="project-meta">
               <span>Owner: {{ project.owner_name || 'You' }}</span>
               <span>{{ project.created_at ? new Date(project.created_at).toLocaleDateString() : '' }}</span>
             </div>
           </router-link>
           <div class="card-actions">
             <router-link :to="`/projects/${project.id}/tickets`" class="btn-tickets">Tickets</router-link>
             <router-link :to="`/projects/${project.id}/ai`" class="btn-ai">AI</router-link>
             <button @click.stop="openEditModal(project)" class="btn-edit">Edit</button>
             <button @click.stop="openDeleteModal(project)" class="btn-delete">Delete</button>
           </div>
         </div>
       </div>
    </div>

    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal">
        <h2>Create New Project</h2>
        <form @submit.prevent="handleCreate">
          <label>Project Name</label>
          <input v-model="projectName" type="text" placeholder="Enter project name" required />
          <label>Description</label>
          <textarea v-model="projectDesc" placeholder="Optional description" rows="3"></textarea>
          <div class="modal-actions">
            <button type="button" @click="showCreateModal = false" class="btn-cancel">Cancel</button>
            <button type="submit" :disabled="creating" class="btn-submit">{{ creating ? 'Creating...' : 'Create' }}</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <h2>Edit Project</h2>
        <form @submit.prevent="handleEdit">
          <label>Project Name</label>
          <input v-model="editName" type="text" placeholder="Enter project name" required />
          <label>Description</label>
          <textarea v-model="editDesc" placeholder="Optional description" rows="3"></textarea>
          <div class="modal-actions">
            <button type="button" @click="showEditModal = false" class="btn-cancel">Cancel</button>
            <button type="submit" :disabled="updating" class="btn-submit">{{ updating ? 'Saving...' : 'Save' }}</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal">
        <h2>Delete Project</h2>
        <p>Are you sure you want to delete "{{ deletingProject?.name }}"? This action cannot be undone.</p>
        <p v-if="deletingProject?.ticketCount > 0" class="warning">Cannot delete: project has {{ deletingProject.ticketCount }} ticket(s).</p>
        <div class="modal-actions">
          <button type="button" @click="showDeleteModal = false" class="btn-cancel">Cancel</button>
          <button type="button" @click="handleDelete" :disabled="deleting || (deletingProject?.ticketCount > 0)" class="btn-delete-modal">
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-list {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  color: #1f2937;
}

.btn-create {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-create:hover {
  background: #2563eb;
}

.error-inline {
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #991b1b;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.error-inline p {
  margin: 0;
}

.error-inline button {
  padding: 6px 12px;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.loading, .error, .empty {
  padding: 60px 20px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.error button {
  margin-top: 12px;
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.empty {
  color: #6b7280;
  padding-top: 120px;
}

.empty .btn-create {
  margin-top: 16px;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.project-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  transition: box-shadow 0.2s;
}

.project-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.card-main {
  display: block;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}

.project-info h3 {
  margin: 0 0 10px 0;
  color: #1f2937;
}

.project-info p {
  margin: 0;
  color: #6b7280;
  line-height: 1.5;
}

.no-desc {
  color: #9ca3af;
  font-style: italic;
}

.project-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #f3f4f6;
  font-size: 13px;
  color: #9ca3af;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
}

.btn-tickets,
.btn-ai {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-tickets {
  background: #3b82f6;
  color: white;
}

.btn-tickets:hover {
  background: #2563eb;
}

.btn-ai {
  background: #8b5cf6;
  color: white;
}

.btn-ai:hover {
  background: #7c3aed;
}

.btn-edit {
  padding: 6px 12px;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.btn-edit:hover {
  background: #e5e7eb;
}

.btn-delete {
  padding: 6px 12px;
  background: white;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.btn-delete:hover {
  background: #fee2e2;
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
  width: 440px;
  max-width: 90vw;
}

.modal h2 {
  margin-bottom: 20px;
  font-size: 20px;
  color: #1f2937;
}

.modal p {
  margin: 0 0 16px 0;
  color: #374151;
  line-height: 1.5;
}

.modal .warning {
  color: #dc2626;
  font-weight: 500;
}

.modal label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.modal input,
.modal textarea {
  width: 100%;
  padding: 10px;
  margin-bottom: 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.modal input:focus,
.modal textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
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

.btn-submit {
  padding: 8px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-submit:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-delete-modal {
  padding: 8px 20px;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-delete-modal:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-delete-modal:hover:not(:disabled) {
  background: #b91c1c;
}
</style>
