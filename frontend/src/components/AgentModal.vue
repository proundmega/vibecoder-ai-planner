<script setup>
import { ref } from 'vue'
import VModal from '@/components/VModal.vue'
import VButton from '@/components/VButton.vue'
import VInput from '@/components/VInput.vue'

defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'created'])

const name = ref('')
const error = ref('')
const loading = ref(false)

function close() {
  emit('update:show', false)
  name.value = ''
  error.value = ''
}

async function submit() {
  if (!name.value.trim()) {
    error.value = 'Name is required'
    return
  }
  if (name.value.trim().length > 100) {
    error.value = 'Name must be 100 characters or less'
    return
  }
  loading.value = true
  error.value = ''
  emit('created', name.value.trim())
}
</script>

<template>
  <VModal :modelValue="show" @update:modelValue="val => emit('update:show', val)" title="Create Agent">
    <form @submit.prevent="submit">
      <VInput
        v-model="name"
        label="Agent Name"
        placeholder="e.g., Code Reviewer"
        :disabled="loading"
        :error="error"
        autofocus
      />
      <div class="modal-actions">
        <VButton type="submit" variant="primary" :loading="loading" :disabled="!name.trim()">
          {{ loading ? 'Creating...' : 'Create' }}
        </VButton>
        <VButton variant="secondary" @click="close" :disabled="loading">Cancel</VButton>
      </div>
    </form>
  </VModal>
</template>

<style scoped>
.modal-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}
</style>
