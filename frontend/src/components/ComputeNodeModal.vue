<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>{{ node ? 'Edit Compute Node' : 'Add Compute Node' }}</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <form @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="hostname">Hostname *</label>
          <input
            id="hostname"
            v-model="form.hostname"
            type="text"
            placeholder="e.g., 192.168.1.100"
            required
          />
        </div>

        <div class="form-group">
          <label for="ssh_port">SSH Port</label>
          <input
            id="ssh_port"
            v-model.number="form.ssh_port"
            type="number"
            min="1"
            max="65535"
          />
        </div>

        <div class="form-group">
          <label for="ssh_user">SSH User *</label>
          <input
            id="ssh_user"
            v-model="form.ssh_user"
            type="text"
            placeholder="e.g., ubuntu"
            required
          />
        </div>

        <div class="form-group">
          <label for="ssh_key_credential_id">SSH Key Credential *</label>
          <select
            id="ssh_key_credential_id"
            v-model="form.ssh_key_credential_id"
            required
          >
            <option value="" disabled>Select a credential</option>
            <option v-for="cred in credentials" :key="cred.id" :value="cred.id">
              {{ cred.name }} ({{ cred.credential_type }})
            </option>
          </select>
        </div>

        <div class="form-group">
          <label for="capacity">Capacity</label>
          <input
            id="capacity"
            v-model.number="form.capacity"
            type="number"
            min="1"
          />
        </div>

        <div class="form-group">
          <label for="labels">Labels (JSON)</label>
          <textarea
            id="labels"
            v-model="labelsJson"
            placeholder='{"gpu": "true", "region": "us-east-1"}'
            rows="3"
          ></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="$emit('close')">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="submitting">
            {{ submitting ? 'Saving...' : (node ? 'Update Node' : 'Add Node') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { createComputeNode, updateComputeNode } from '../api/computeNodes'
import { getActiveCredentials } from '../api/credentials'
import type { ComputeNode } from '../api/computeNodes'

const props = defineProps<{
  projectId: string
  node?: ComputeNode | null
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const form = ref({
  hostname: '',
  ssh_port: 22,
  ssh_user: '',
  ssh_key_credential_id: '',
  capacity: 1,
  labels: '{}',
})

const labelsJson = computed({
  get: () => form.value.labels,
  set: (val: string) => { form.value.labels = val },
})

const credentials = ref<any[]>([])
const submitting = ref(false)

async function fetchCredentials() {
  try {
    credentials.value = await getActiveCredentials(props.projectId)
  } catch (err) {
    console.error('Failed to fetch credentials:', err)
  }
}

watch(() => props.node, (node) => {
  if (node) {
    form.value = {
      hostname: node.hostname,
      ssh_port: node.ssh_port,
      ssh_user: node.ssh_user,
      ssh_key_credential_id: node.ssh_key_credential_id,
      capacity: node.capacity,
      labels: JSON.stringify(node.labels, null, 2),
    }
  }
}, { immediate: true })

async function handleSubmit() {
  submitting.value = true
  try {
    const labels = JSON.parse(form.value.labels)
    const data = {
      hostname: form.value.hostname,
      ssh_port: form.value.ssh_port,
      ssh_user: form.value.ssh_user,
      ssh_key_credential_id: form.value.ssh_key_credential_id,
      capacity: form.value.capacity,
      labels,
    }

    if (props.node) {
      await updateComputeNode(props.node.id, data)
    } else {
      await createComputeNode(data)
    }
    emit('saved')
  } catch (err) {
    console.error('Failed to save node:', err)
  } finally {
    submitting.value = false
  }
}

fetchCredentials()
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.modal-header h3 {
  margin: 0;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6b7280;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #111827;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #374151;
  font-size: 0.875rem;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.875rem;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background: #e5e7eb;
}
</style>
