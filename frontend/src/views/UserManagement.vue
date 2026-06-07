<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { listUsers, createUser, updateUser, toggleUserActive, deleteUser } from '@/api/users'
import UserModal from '@/components/UserModal.vue'

const authStore = useAuthStore()
const users = ref([])
const loading = ref(true)
const error = ref(null)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingUser = ref(null)
const searchQuery = ref('')
const roleFilter = ref('')
const showDeleteConfirm = ref(null)
const actionLoading = ref(false)

const canCreate = computed(() => authStore.canCreateUser())

const canDelete = computed(() => authStore.canDeleteUser())

const canToggleActive = computed(() => authStore.canToggleUser())

function roleLabel(role) {
  const labels = {
    project_admin: 'Project Admin',
    member: 'Member',
    user: 'AI Agent',
    super_admin: 'Super Admin'
  }
  return labels[role] || role
}

function createdByLabel(user) {
  if (!user.user_created_by) return 'Self-registered'
  // We'd need to fetch creator name, for now show ID
  return `User #${user.user_created_by}`
}

async function loadUsers() {
  loading.value = true
  error.value = null
  try {
    const filters = {}
    if (roleFilter.value) filters.role = roleFilter.value
    if (searchQuery.value) filters.search = searchQuery.value
    const response = await listUsers(filters)
    users.value = response || []
  } catch (err) {
    console.error('Failed to load users:', err)
    error.value = err.message || 'Failed to load users'
  } finally {
    loading.value = false
  }
}

async function handleCreate(data) {
  actionLoading.value = true
  try {
    await createUser(data)
    showCreateModal.value = false
    await loadUsers()
  } catch (err) {
    console.error('Failed to create user:', err)
    error.value = err.message || 'Failed to create user'
  } finally {
    actionLoading.value = false
  }
}

async function handleEdit(user, data) {
  actionLoading.value = true
  try {
    await updateUser(user.id, data)
    showEditModal.value = false
    editingUser.value = null
    await loadUsers()
  } catch (err) {
    console.error('Failed to update user:', err)
    error.value = err.message || 'Failed to update user'
  } finally {
    actionLoading.value = false
  }
}

async function handleToggleActive(user) {
  if (!confirm(`Are you sure you want to ${user.is_active ? 'deactivate' : 'activate'} ${user.name}?`)) return
  try {
    await toggleUserActive(user.id)
    await loadUsers()
  } catch (err) {
    console.error('Failed to toggle user:', err)
    error.value = err.message || 'Failed to toggle user'
  }
}

async function handleDelete(user) {
  if (!confirm(`Are you sure you want to delete ${user.name}? This action cannot be undone.`)) return
  try {
    await deleteUser(user.id)
    showDeleteConfirm.value = null
    await loadUsers()
  } catch (err) {
    console.error('Failed to delete user:', err)
    error.value = err.message || 'Failed to delete user'
  }
}

function openEditModal(user) {
  editingUser.value = user
  showEditModal.value = true
}

onMounted(loadUsers)
</script>

<template>
  <div class="user-management">
    <div class="header">
      <h1>Manage Users</h1>
      <button v-if="canCreate" @click="showCreateModal = true" class="btn-primary">
        Create User
      </button>
    </div>

    <div class="filters">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search by name or email..."
        class="search-input"
        @input="loadUsers"
      />
      <select v-model="roleFilter" class="role-filter" @change="loadUsers">
        <option value="">All Roles</option>
        <option value="project_admin">Project Admin</option>
        <option value="member">Member</option>
        <option value="user">AI Agent</option>
      </select>
    </div>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="loadUsers">Retry</button>
    </div>

    <div v-else-if="users.length === 0" class="empty">
      <p>No users found.</p>
    </div>

    <div v-else class="user-table">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Created By</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>{{ user.name || 'Unnamed' }}</td>
            <td>{{ user.email }}</td>
            <td>{{ roleLabel(user.role) }}</td>
            <td>{{ createdByLabel(user) }}</td>
            <td>
              <span :class="['status-badge', user.is_active ? 'active' : 'inactive']">
                {{ user.is_active ? 'Active' : 'Deactivated' }}
              </span>
            </td>
            <td class="actions">
              <button @click="openEditModal(user)" class="btn-edit" title="Edit">Edit</button>
              <button
                v-if="canToggleActive"
                @click="handleToggleActive(user)"
                :class="['btn-toggle', user.is_active ? 'btn-deactivate' : 'btn-activate']"
                :title="user.is_active ? 'Deactivate' : 'Activate'"
              >
                {{ user.is_active ? 'Deactivate' : 'Activate' }}
              </button>
              <button
                v-if="canDelete"
                @click="showDeleteConfirm = user"
                class="btn-delete"
                title="Delete"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UserModal
      v-if="showCreateModal"
      :is-edit="false"
      @submit="handleCreate"
      @close="showCreateModal = false"
    />

    <UserModal
      v-if="showEditModal && editingUser"
      :is-edit="true"
      :user="editingUser"
      @submit="(data) => handleEdit(editingUser, data)"
      @close="showEditModal = false"
    />

    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = null">
      <div class="modal delete-confirm">
        <h2>Confirm Delete</h2>
        <p>Are you sure you want to delete <strong>{{ showDeleteConfirm.name }}</strong>?</p>
        <p class="warning">This action cannot be undone.</p>
        <div class="modal-actions">
          <button @click="showDeleteConfirm = null" class="btn-cancel">Cancel</button>
          <button @click="handleDelete(showDeleteConfirm)" class="btn-submit btn-danger" :disabled="actionLoading">
            {{ actionLoading ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-management {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
  color: #1f2937;
}

.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.search-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.role-filter {
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  background: white;
}

.user-table {
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

tr:hover {
  background: #f9fafb;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.active {
  background: #d1fae5;
  color: #065f46;
}

.status-badge.inactive {
  background: #fee2e2;
  color: #991b1b;
}

.actions {
  display: flex;
  gap: 8px;
}

button {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.btn-primary {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  font-size: 14px;
}

.btn-edit {
  background: #3b82f6;
  color: white;
}

.btn-edit:hover {
  background: #2563eb;
}

.btn-toggle {
  color: white;
}

.btn-activate {
  background: #10b981;
}

.btn-activate:hover {
  background: #059669;
}

.btn-deactivate {
  background: #f59e0b;
}

.btn-deactivate:hover {
  background: #d97706;
}

.btn-delete {
  background: #ef4444;
  color: white;
}

.btn-delete:hover {
  background: #dc2626;
}

.loading, .empty {
  padding: 60px;
  text-align: center;
  color: #6b7280;
}

.error {
  padding: 20px;
  background: #fee2e2;
  border-radius: 8px;
  color: #991b1b;
  text-align: center;
}

.error button {
  margin-top: 12px;
  padding: 8px 16px;
  background: #ef4444;
  color: white;
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
