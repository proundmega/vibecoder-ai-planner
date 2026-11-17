<script setup>
import { ref } from 'vue'
import VModal from '@/components/VModal.vue'
import VButton from '@/components/VButton.vue'

const props = defineProps({
  agent: { type: Object, required: true },
  title: { type: String, default: 'Agent created' },
  warning: {
    type: String,
    default: 'This is the only time this key is shown. Store it now — it cannot be retrieved later.',
  },
})

const emit = defineEmits(['close'])

const copied = ref(false)
const copyError = ref('')

async function copyKey() {
  const value = props.agent.apiKey
  if (!value) return
  copyError.value = ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      // Clipboard API requires a secure context; LAN HTTP deployments need
      // this fallback.
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const copiedOk = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!copiedOk) throw new Error('copy failed')
    }
    copied.value = true
  } catch {
    copyError.value = 'Could not copy automatically. Select the key and copy it manually.'
  }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}
</script>

<template>
  <VModal :modelValue="true" :title="title" size="medium" @close="emit('close')">
    <div class="agent-key-reveal">
      <p class="intro">
        The agent is ready. Save its credentials before closing this dialog.
      </p>

      <dl class="details">
        <div>
          <dt>Name</dt>
          <dd>{{ agent.name || '—' }}</dd>
        </div>
        <div>
          <dt>Agent ID</dt>
          <dd>{{ agent.id ?? '—' }}</dd>
        </div>
        <div v-if="agent.providerName">
          <dt>Provider</dt>
          <dd>{{ agent.providerName }}</dd>
        </div>
        <div>
          <dt>Key expires</dt>
          <dd>{{ formatDate(agent.expiresAt) }}</dd>
        </div>
      </dl>

      <div v-if="agent.apiKey" class="key-section">
        <label>API key</label>
        <div class="key-row">
          <code class="agent-key-value">{{ agent.apiKey }}</code>
          <VButton variant="secondary" size="small" @click="copyKey">
            {{ copied ? 'Copied' : 'Copy key' }}
          </VButton>
        </div>
        <p v-if="copyError" class="copy-error">{{ copyError }}</p>
      </div>
      <p v-else class="key-unavailable">
        No key was returned. Revoke and rotate the key from the agent details to issue a new one.
      </p>

      <p class="warning">{{ warning }}</p>

      <div class="modal-actions">
        <VButton variant="primary" @click="emit('close')">Done</VButton>
      </div>
    </div>
  </VModal>
</template>

<style scoped>
.intro {
  margin: 0 0 var(--spacing-md);
  color: var(--color-text-secondary);
}

.details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--spacing-md);
  margin: 0 0 var(--spacing-lg);
}

.details div {
  min-width: 0;
}

.details dt {
  margin-bottom: 4px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.details dd {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
  word-break: break-word;
}

.key-section {
  margin-bottom: var(--spacing-md);
}

.key-section label {
  display: block;
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.key-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.agent-key-value {
  flex: 1;
  min-width: 0;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  font-family: monospace;
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
  user-select: all;
}

.copy-error {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

.key-unavailable {
  padding: var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.warning {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-warning-light, #fef3c7);
  color: #92400e;
  font-size: var(--font-size-sm);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}
</style>
