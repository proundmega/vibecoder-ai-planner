<script setup>
import { ref, onMounted } from 'vue'
import { listAllUsers, toggleUserActive, updateUser } from '@/api/users'

const users = ref([])
const loading = ref(true)
const error = ref(null)
const searchQuery = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const editingUser = ref(null)
const showEditModal = ref(false)
const actionLoading = ref(false)

async function loadUsers() {
  loading.value = true
  error.value = null
  try {
    const filters = {}
    if (roleFilter.value) filters.role = roleFilter.value
    if (searchQuery.value) filters.search = searchQuery.value
    if (statusFilter.value === 'active') filters.is_active = true
    if (statusFilter.value === 'inactive') filters.is_active = false
    const response = await listAllUsers(filters)
    users.value = response.users || response || []
  } catch (err) {
    console.error('Failed to load users:', err)
    error.value = err.message || 'Failed to load users'
  } finally {
    loading.value = false
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

function openEditModal(user) {
  editingUser.value = { ...user }
  showEditModal.value = true
}

async function handleEditName(user, name) {
  actionLoading.value = true
  try {
    await updateUser(user.id, { name: name.trim() })
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

function roleLabel(role) {
  const labels = {
    project_admin: 'Project Admin',
    member: 'Member',
    user: 'AI Agent',
    super_admin: 'Super Admin'
  }
  return labels[role] || role
}

onMounted(loadUsers)
</script>

<template>
  <div class="super-admin-users">
    <div class="header">
      <h1>Super Admin — All Users</h1>
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
        <option value="super_admin">Super Admin</option>
      </select>
      <select v-model="statusFilter" class="status-filter" @change="loadUsers">
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="inactive">Deactivated</option>
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
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>{{ user.name || 'Unnamed' }}</td>
            <td>{{ user.email }}</td>
            <td>{{ roleLabel(user.role) }}</td>
            <td>
              <span :class="['status-badge', user.is_active ? 'active' : 'inactive']">
                {{ user.is_active ? 'Active' : 'Deactivated' }}
              </span>
            </td>
            <td class="actions">
              <button @click="openEditModal(user)" class="btn-edit" title="Edit">Edit</button>
              <button
                v-if="user.role !== 'super_admin'"
                @click="handleToggleActive(user)"
                :class="['btn-toggle', user.is_active ? 'btn-deactivate' : 'btn-activate']"
                :title="user.is_active ? 'Deactivate' : 'Activate'"
              >
                {{ user.is_active ? 'Deactivate' : 'Activate' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showEditModal && editingUser" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <h2>Edit User</h2>
        <form @submit.prevent="handleEditName(editingUser, editingUser.name)">
          <label>Name</label>
          <input v-model="editingUser.name" type="text" placeholder="User name" required />
          <p class="hint">Role cannot be changed after account creation</p>
          <p v-if="error" class="error">{{ error }}</p>
          <div class="modal-actions">
            <button type="button" @click="showEditModal = false" class="btn-cancel">Cancel</button>
            <button type="submit" :disabled="actionLoading" class="btn-submit">
              {{ actionLoading ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.super-admin-users {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.header {
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

.role-filter,
.status-filter {
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

.modal h2 {
  margin-bottom: 20px;
  font-size: 20px;
  color: #1f2937;
}

.modal label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.modal input {
  width: 100%;
  padding: 10px;
  margin-bottom: 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.hint {
  font-size: 12px;
  color: #6b7280;
  margin: -10px 0 16px 0;
}

.error {
  color: #ef4444;
  font-size: 13px;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: #fee2e2;
  border-radius: 6px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
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
</style>
