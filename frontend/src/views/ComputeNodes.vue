<template>
  <div class="compute-nodes-page">
    <div class="header">
      <h2>Compute Nodes</h2>
      <button class="btn btn-primary" @click="showNewModal = true">Add Node</button>
    </div>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else>
      <div v-if="nodes.length === 0" class="empty-state">
        <p>No compute nodes configured. Add a remote Docker host to enable distributed agent provisioning.</p>
      </div>

      <div v-else class="nodes-list">
        <div
          v-for="node in nodes"
          :key="node.id"
          class="node-card"
        >
          <div class="node-info">
            <div class="node-header">
              <h3>{{ node.hostname }}:{{ node.ssh_port }}</h3>
              <span class="status-badge" :class="node.status">{{ node.status }}</span>
            </div>
            <p class="node-details">
              User: {{ node.ssh_user }} | Capacity: {{ node.capacity }} | Failures: {{ node.failure_count }}
            </p>
            <p v-if="node.last_seen" class="node-meta">
              Last seen: {{ formatDate(node.last_seen) }}
            </p>
            <div v-if="Object.keys(node.labels).length > 0" class="node-labels">
              <span v-for="(value, key) in node.labels" :key="key" class="label">
                {{ key }}={{ value }}
              </span>
            </div>
          </div>

          <div class="node-actions">
            <button
              class="btn btn-sm"
              :class="testing === node.id ? 'btn-loading' : 'btn-secondary'"
              @click="testNode(node.id)"
              :disabled="testing === node.id"
            >
              {{ testing === node.id ? 'Testing...' : 'Test' }}
            </button>
            <button class="btn btn-sm btn-secondary" @click="editNode(node)">Edit</button>
            <button class="btn btn-sm btn-danger" @click="deleteNode(node.id)">Delete</button>
          </div>

          <div v-if="testResults[node.id]" class="test-result">
            <span :class="testResults[node.id].success ? 'success' : 'error'">
              {{ testResults[node.id].success ? '✓ Connection successful' : '✗ ' + testResults[node.id].error }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <ComputeNodeModal
      v-if="showNewModal || editingNode"
      :project-id="projectId"
      :node="editingNode"
      @close="closeModal"
      @saved="onNodeSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  listComputeNodes,
  deleteComputeNode,
  testComputeNodeConnection,
} from '../api/computeNodes'
import type { ComputeNode } from '../api/computeNodes'
import ComputeNodeModal from '../components/ComputeNodeModal.vue'

const route = useRoute()
const projectId = computed(() => route.params.id as string)

const nodes = ref<ComputeNode[]>([])
const loading = ref(false)
const showNewModal = ref(false)
const editingNode = ref<ComputeNode | null>(null)
const testing = ref<string | null>(null)
const testResults = ref<Record<string, { success: boolean; error?: string }>>({})

async function fetchNodes() {
  loading.value = true
  try {
    nodes.value = await listComputeNodes()
  } catch (err) {
    console.error('Failed to fetch compute nodes:', err)
  } finally {
    loading.value = false
  }
}

async function testNode(id: string) {
  testing.value = id
  try {
    const result = await testComputeNodeConnection(id)
    testResults.value[id] = result
    if (result.success) {
      await fetchNodes()
    }
  } catch (err) {
    console.error('Test connection failed:', err)
    testResults.value[id] = { success: false, error: 'Connection failed' }
  } finally {
    testing.value = null
  }
}

function editNode(node: ComputeNode) {
  editingNode.value = { ...node }
}

async function deleteNode(id: string) {
  if (!confirm('Are you sure you want to delete this compute node?')) return
  try {
    await deleteComputeNode(id)
    await fetchNodes()
  } catch (err) {
    console.error('Failed to delete node:', err)
  }
}

function closeModal() {
  showNewModal.value = false
  editingNode.value = null
}

async function onNodeSaved() {
  closeModal()
  await fetchNodes()
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString()
}

onMounted(fetchNodes)
</script>

<style scoped>
.compute-nodes-page {
  padding: 24px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
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

.btn-primary:hover {
  background: #2563eb;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background: #e5e7eb;
}

.btn-danger {
  background: #fee2e2;
  color: #dc2626;
}

.btn-danger:hover {
  background: #fecaca;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 0.75rem;
}

.btn-loading {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #6b7280;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.nodes-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.node-card {
  padding: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: white;
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.node-header h3 {
  margin: 0;
  color: #111827;
  font-size: 1.125rem;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.online {
  background: #dcfce7;
  color: #166534;
}

.status-badge.offline {
  background: #f3f4f6;
  color: #6b7280;
}

.status-badge.degraded {
  background: #fef3c7;
  color: #92400e;
}

.status-badge.draining {
  background: #fee2e2;
  color: #dc2626;
}

.node-details {
  margin: 0 0 4px;
  color: #4b5563;
  font-size: 0.875rem;
}

.node-meta {
  margin: 0 0 8px;
  color: #6b7280;
  font-size: 0.75rem;
}

.node-labels {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.label {
  padding: 2px 8px;
  background: #f3f4f6;
  border-radius: 4px;
  font-size: 0.75rem;
  color: #4b5563;
}

.node-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.test-result {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.875rem;
}

.test-result .success {
  color: #166534;
  background: #dcfce7;
}

.test-result .error {
  color: #dc2626;
  background: #fee2e2;
}
</style>
