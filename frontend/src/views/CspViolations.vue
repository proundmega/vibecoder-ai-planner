<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getCspViolations, clearCspViolations, CspViolation } from '@/api/cspViolations'

const violations = ref<CspViolation[]>([])
const total = ref(0)
const limit = ref(20)
const offset = ref(0)
const filterDirective = ref('')
const loading = ref(false)
const error = ref('')

const directives = [
  'script-src',
  'style-src',
  'img-src',
  'connect-src',
  'default-src',
  'font-src',
  'frame-src',
  'media-src',
  'object-src',
  'prefetch-src',
  'manifest-src',
  'worker-src',
  'child-src',
  'frame-ancestors',
  'base-uri',
  'form-action',
  'upgrade-insecure-requests',
  'block-all-mixed-content',
  'plugin-types',
  'sandbox',
]

async function loadViolations() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, unknown> = {
      limit: limit.value,
      offset: offset.value,
    }
    if (filterDirective.value) {
      params.directive = filterDirective.value
    }
    const response = await getCspViolations(params)
    violations.value = response.violations
    total.value = response.total
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load violations'
  } finally {
    loading.value = false
  }
}

function prevPage() {
  offset.value = Math.max(0, offset.value - limit.value)
  loadViolations()
}

function nextPage() {
  offset.value += limit.value
  loadViolations()
}

async function clearAll() {
  if (!confirm('Clear all CSP violations? This cannot be undone.')) return
  try {
    await clearCspViolations()
    violations.value = []
    total.value = 0
    offset.value = 0
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to clear violations'
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

onMounted(loadViolations)
</script>

<template>
  <div class="csp-violations">
    <h2>CSP Violations</h2>

    <div class="filters">
      <select v-model="filterDirective" @change="loadViolations">
        <option value="">All Directives</option>
        <option v-for="d in directives" :key="d" :value="d">{{ d }}</option>
      </select>
      <button @click="loadViolations" :disabled="loading">Refresh</button>
      <button @click="clearAll" class="danger" :disabled="loading || violations.length === 0">
        Clear All
      </button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="loading" class="loading">Loading...</div>

    <table v-else-if="violations.length">
      <thead>
        <tr>
          <th>Date</th>
          <th>Directive</th>
          <th>Blocked URI</th>
          <th>Document</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in violations" :key="v.id">
          <td>{{ formatDate(v.created_at) }}</td>
          <td><code>{{ v.violated_directive }}</code></td>
          <td><code class="truncate" :title="v.blocked_uri">{{ v.blocked_uri }}</code></td>
          <td><code class="truncate" :title="v.document_uri">{{ v.document_uri }}</code></td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No violations found.</p>

    <div v-if="total > limit" class="pagination">
      <button @click="prevPage" :disabled="offset === 0">Previous</button>
      <span>Page {{ Math.floor(offset / limit) + 1 }} of {{ Math.ceil(total / limit) }}</span>
      <button @click="nextPage" :disabled="offset + limit >= total">Next</button>
    </div>
  </div>
</template>

<style scoped>
.csp-violations {
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.csp-violations h2 {
  margin: 0 0 1rem 0;
  font-size: 24px;
  color: #1f2937;
}

.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  align-items: center;
}

.filters select {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  font-size: 14px;
}

.filters button {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 14px;
  background: white;
}

.filters button:hover:not(:disabled) {
  background: #f3f4f6;
}

.filters button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger {
  background: #ef4444 !important;
  color: white !important;
  border-color: #ef4444 !important;
}

.danger:hover:not(:disabled) {
  background: #dc2626 !important;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

th, td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

code {
  font-family: monospace;
  font-size: 0.875rem;
  background: #f3f4f6;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
}

.truncate {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}

.pagination button {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  cursor: pointer;
  background: white;
  font-size: 14px;
}

.pagination button:hover:not(:disabled) {
  background: #f3f4f6;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading, .empty {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
}

.error {
  padding: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.25rem;
  color: #dc2626;
  margin-bottom: 1rem;
}
</style>
