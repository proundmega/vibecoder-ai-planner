<script setup>
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  isEdit: { type: Boolean, default: false },
  user: { type: Object, default: null }
})

const emit = defineEmits(['submit', 'close'])
const authStore = useAuthStore()

const name = ref('')
const email = ref('')
const password = ref('')
const role = ref('user')
const loading = ref(false)
const error = ref(null)

const currentRole = computed(() => {
  const user = authStore.user.value
  return user?.role || user?.ROLE || 'project_admin'
})

const availableRoles = computed(() => {
  const role = currentRole.value
  if (role === 'project_admin' || role === 'ADMIN') {
    return [
      { value: 'member', label: 'Member' },
      { value: 'user', label: 'AI Agent' }
    ]
  } else if (role === 'member' || role === 'MEMBER') {
    return [{ value: 'user', label: 'AI Agent' }]
  }
  return []
})

watch(() => props.isEdit, (isEdit) => {
  if (isEdit && props.user) {
    name.value = props.user.name || ''
    email.value = props.user.email || ''
    password.value = ''
    role.value = props.user.role || 'user'
  } else if (!isEdit) {
    name.value = ''
    email.value = ''
    password.value = ''
    role.value = availableRoles.value[0]?.value || 'user'
  }
})

async function handleSubmit() {
  if (!name.value.trim() || !email.value.trim()) {
    error.value = 'Name and email are required'
    return
  }
  
  if (!props.isEdit && !password.value) {
    error.value = 'Password is required'
    return
  }
  
  if (!props.isEdit && password.value.length < 6) {
    error.value = 'Password must be at least 6 characters'
    return
  }
  
  loading.value = true
  error.value = null
  
  try {
    const data = {
      name: name.value.trim(),
      email: email.value.trim(),
      role: role.value
    }
    
    if (!props.isEdit) {
      data.password = password.value
    }
    
    emit('submit', data)
  } catch (err) {
    error.value = err.message || 'Failed to save user'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>{{ isEdit ? 'Edit User' : 'Create New User' }}</h2>
      
      <form @submit.prevent="handleSubmit">
        <label>Name</label>
        <input v-model="name" type="text" placeholder="User name" required />
        
        <label>Email</label>
        <input v-model="email" type="email" placeholder="user@example.com" required />
        
        <label v-if="!isEdit">Password</label>
        <input
          v-if="!isEdit"
          v-model="password"
          type="password"
          placeholder="Min 6 characters"
          minlength="6"
          required
        />
        
        <label>Role</label>
        <select v-model="role" :disabled="isEdit">
          <option v-for="r in availableRoles" :key="r.value" :value="r.value">
            {{ r.label }}
          </option>
        </select>
        <p v-if="isEdit" class="hint">Role cannot be changed after account creation</p>
        
        <p v-if="error" class="error">{{ error }}</p>
        
        <div class="modal-actions">
          <button type="button" @click="$emit('close')" class="btn-cancel">Cancel</button>
          <button type="submit" :disabled="loading" class="btn-submit">
            {{ loading ? 'Saving...' : (isEdit ? 'Save' : 'Create') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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

.modal input,
.modal select {
  width: 100%;
  padding: 10px;
  margin-bottom: 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.modal select:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
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
