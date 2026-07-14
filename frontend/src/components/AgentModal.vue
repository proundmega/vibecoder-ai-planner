<script setup>
import { ref, computed } from 'vue'
import VModal from '@/components/VModal.vue'
import VButton from '@/components/VButton.vue'
import VInput from '@/components/VInput.vue'

const props = defineProps({
  show: Boolean,
  providers: { type: Array, default: () => [] },
  selectedProvider: { type: String, default: null },
})

const emit = defineEmits(['update:show', 'created', 'update:selectedProvider'])

const name = ref('')
const error = ref('')
const loading = ref(false)
const rateLimit = ref(100)
const maxActionsPerDay = ref(1000)
const keyExpiryDays = ref(30)

const providerOptions = computed(() => props.providers.map(p => ({
  value: p.id,
  label: `${p.name} (${p.providerType})`,
})))

function close() {
  emit('update:show', false)
  name.value = ''
  error.value = ''
  rateLimit.value = 100
  maxActionsPerDay.value = 1000
  keyExpiryDays.value = 30
  emit('update:selectedProvider', null)
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
  emit('created', name.value.trim(), props.selectedProvider, rateLimit.value, maxActionsPerDay.value, keyExpiryDays.value)
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
      <div class="form-group">
        <label>AI Provider</label>
        <select v-model="props.selectedProvider" @change="emit('update:selectedProvider', $event.target.value)" :disabled="loading">
          <option :value="null">Select a provider...</option>
          <option v-for="opt in providerOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <p v-if="providerOptions.length === 0" class="hint">
          No providers configured. <router-link to="/providers">Go to Providers</router-link> to add one.
        </p>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Rate Limit (req/min)</label>
          <input type="number" v-model.number="rateLimit" min="1" max="10000" :disabled="loading" />
        </div>
        <div class="form-group">
          <label>Max Actions/Day</label>
          <input type="number" v-model.number="maxActionsPerDay" min="1" max="100000" :disabled="loading" />
        </div>
      </div>
      <div class="form-group">
        <label>API Key Expiry (days)</label>
        <input type="number" v-model.number="keyExpiryDays" min="1" max="365" :disabled="loading" />
      </div>
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
.form-group {
  margin-bottom: var(--spacing-md);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.form-group label {
  display: block;
  margin-bottom: var(--spacing-xs);
  font-weight: 500;
  font-size: var(--font-size-sm);
}

.form-group select,
.form-group input[type="number"] {
  width: 100%;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  font-size: var(--font-size-base);
}

.hint {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.modal-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}
</style>
