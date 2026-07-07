<script setup>
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import VModal from '@/components/VModal.vue'
import VButton from '@/components/VButton.vue'
import VInput from '@/components/VInput.vue'

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
  return user?.role || 'project_admin'
})

const availableRoles = computed(() => {
  const role = currentRole.value
  if (role === 'project_admin') {
    return [
      { value: 'member', label: 'Member' },
      { value: 'user', label: 'AI Agent' }
    ]
  } else if (role === 'member') {
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
}, { immediate: true })

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
  <VModal v-model="true" :title="isEdit ? 'Edit User' : 'Create New User'" @close="emit('close')">
    <form @submit.prevent="handleSubmit">
      <VInput v-model="name" label="Name" placeholder="User name" required />
      
      <VInput v-model="email" label="Email" placeholder="user@example.com" type="email" required />
      
      <VInput v-if="!isEdit" v-model="password" label="Password" placeholder="Min 6 characters" type="password" minlength="6" required />
      
      <VInput v-model="role" label="Role" type="select" :disabled="isEdit">
        <option v-for="r in availableRoles" :key="r.value" :value="r.value">
          {{ r.label }}
        </option>
      </VInput>
      
      <p v-if="isEdit" class="hint">Role cannot be changed after account creation</p>
      <p v-if="error" class="error">{{ error }}</p>
      
      <div class="modal-actions">
        <VButton variant="secondary" @click="emit('close')">Cancel</VButton>
        <VButton type="submit" variant="primary" :loading="loading">
          {{ loading ? 'Saving...' : (isEdit ? 'Save' : 'Create') }}
        </VButton>
      </div>
    </form>
  </VModal>
</template>

<style scoped>
.hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: calc(var(--spacing-xs) * -1) 0 var(--spacing-md) 0;
}

.error {
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  margin: 0 0 var(--spacing-sm) 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-danger-light);
  border-radius: var(--radius-md);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}
</style>
