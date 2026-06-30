<script setup>
import { ref, onMounted } from 'vue'
import { listTemplates } from '@/api/templates'

const props = defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const templates = ref([])
const selectedTemplate = ref('')
const planContent = ref('')
const error = ref('')
const saving = ref(false)

const templateOptions = [
  { key: 'architecture', label: 'Architecture', desc: 'Detailed architecture planning with system design' },
  { key: 'technical', label: 'Technical', desc: 'Technical implementation plan with steps' },
  { key: 'simple', label: 'Simple', desc: 'Simple task breakdown with checkboxes' },
  { key: 'specification', label: 'Specification', desc: 'Model execution spec with exact file operations' },
]

onMounted(async () => {
  try {
    const response = await listTemplates(props.projectId)
    templates.value = response?.data || []
  } catch (e) {
    console.error('Failed to load templates:', e)
  }
})

async function handleMarkReady() {
  error.value = ''

  if (!selectedTemplate.value) {
    error.value = 'Please select a template'
    return
  }

  saving.value = true
  try {
    emit('transition', 'plan_approved', {
      template: selectedTemplate.value,
      content: planContent.value,
    })
  } catch (e) {
    error.value = e.message || 'Failed to mark as ready'
  } finally {
    saving.value = false
  }
}

function simpleMarkdownToHtml(text) {
  if (!text) return ''
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>')
}
</script>

<template>
  <div class="phase-planning">
    <h2>Planning Phase</h2>
    <p class="phase-description">
      Select a template and prepare your planning documents.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="template-selector">
      <h3>Select Template</h3>
      <div class="template-options">
        <button
          v-for="t in templateOptions"
          :key="t.key"
          @click="selectedTemplate = t.key"
          :class="['template-card', { selected: selectedTemplate === t.key }]"
        >
          <h4>{{ t.label }}</h4>
          <p>{{ t.desc }}</p>
        </button>
      </div>

      <div v-if="templates.length > 0" class="custom-templates">
        <h3>Custom Templates</h3>
        <div class="template-options">
          <button
            v-for="t in templates"
            :key="t.id"
            @click="selectedTemplate = t.name"
            :class="['template-card', 'custom', { selected: selectedTemplate === t.name }]"
          >
            <h4>{{ t.name }}</h4>
            <p>{{ t.description || `${t.file_definitions_count || 0} files` }}</p>
          </button>
        </div>
      </div>
    </div>

    <div class="planning-editor">
      <h3>Planning Notes</h3>
      <textarea
        v-model="planContent"
        rows="12"
        placeholder="Add planning notes, considerations, or implementation details..."
      ></textarea>
      <div v-if="planContent" class="preview" v-html="simpleMarkdownToHtml(planContent)"></div>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back to Draft</button>
      <button @click="handleMarkReady" :disabled="saving" class="btn-primary">
        {{ saving ? 'Saving...' : 'Mark as Ready' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-planning {
  max-width: 700px;
}

.phase-planning h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.error-banner {
  padding: 12px 16px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  margin-bottom: 20px;
  font-size: 14px;
}

.template-selector h3,
.planning-editor h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #374151;
}

.template-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.template-card {
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}

.template-card:hover {
  border-color: #3b82f6;
  background: #f9fafb;
}

.template-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.template-card h4 {
  margin: 0 0 6px;
  color: #1f2937;
}

.template-card p {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

.template-card.custom {
  border-color: #a78bfa;
}

.template-card.custom.selected {
  border-color: #8b5cf6;
  background: #ede9fe;
}

.custom-templates {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}

.planning-editor {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}

.planning-editor textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-family: monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  min-height: 200px;
}

.planning-editor textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.preview {
  margin-top: 12px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  line-height: 1.6;
}

.preview h1, .preview h2, .preview h3 {
  margin: 12px 0 8px;
}

.preview strong {
  font-weight: 600;
}

.preview code {
  background: #e5e7eb;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 13px;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.btn-primary {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary:hover {
  background: #f9fafb;
}
</style>
