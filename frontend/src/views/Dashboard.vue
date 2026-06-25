<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchProjects } from '@/api/projects'
import { getUserUsage, getModelPricing, getProjectUsage } from '@/api/usage'

const authStore = useAuthStore()
const router = useRouter()
const projects = ref([])
const loading = ref(true)
const error = ref(null)
const activeTab = ref('projects')
const tabs = [
  { id: 'projects', label: 'Projects' },
  { id: 'usage', label: 'Usage' },
]

const usageLoading = ref(false)
const usageError = ref(null)
const userUsage = ref(null)
const pricingData = ref([])
const projectUsages = ref([])

onMounted(async () => {
  try {
    projects.value = await fetchProjects()
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
    error.value = 'Failed to load dashboard data'
  } finally {
    loading.value = false
  }
})

async function loadUsageData() {
  usageLoading.value = true
  usageError.value = null
  try {
    const [userUsageData, pricing] = await Promise.all([
      getUserUsage(),
      getModelPricing(),
    ])
    userUsage.value = userUsageData
    pricingData.value = pricing?.models || []
    const projectUsagesData = await Promise.all(
      projects.value.map(async (p) => {
        const usage = await getProjectUsage(p.id)
        return {
          project: p,
          usage: usage?.data || null,
        }
      })
    )
    projectUsages.value = projectUsagesData
  } catch (err) {
    console.error('Failed to load usage data:', err)
    usageError.value = 'Failed to load usage data'
  } finally {
    usageLoading.value = false
  }
}

watch(activeTab, (newTab) => {
  if (newTab === 'usage') {
    loadUsageData()
  }
})
</script>

<template>
  <div class="dashboard">
    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
    </div>
    <div v-else>
      <h1>Dashboard</h1>
      <p class="welcome">Welcome back, {{ authStore.user?.name || 'User' }}</p>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ projects.length }}</div>
          <div class="stat-label">Projects</div>
        </div>
      </div>

      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTab === 'projects'" class="section">
        <div class="section-header">
          <h2>Your Projects</h2>
          <router-link to="/projects" class="view-all">View All</router-link>
        </div>

        <div v-if="projects.length === 0" class="empty-state">
          <p>No projects yet</p>
          <router-link to="/projects" class="btn-create">Create Your First Project</router-link>
        </div>

        <div v-else class="projects-grid">
          <div
            v-for="project in projects"
            :key="project.id"
            class="project-card"
            @click="router.push(`/projects/${project.id}/tickets`)"
          >
            <div class="project-info">
              <h3>{{ project.name }}</h3>
              <p v-if="project.description">{{ project.description }}</p>
              <p v-else class="no-desc">No description</p>
            </div>
            <div class="project-meta">
              <span>{{ project.created_at ? new Date(project.created_at).toLocaleDateString() : '' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'usage'" class="section">
        <div v-if="usageLoading" class="loading">Loading usage data...</div>
        <div v-else-if="usageError" class="error">{{ usageError }}</div>
        <template v-else>
          <div class="section-header">
            <h2>Per-Project Usage</h2>
          </div>

          <div v-if="projectUsages.length === 0" class="empty-state">
            <p>No projects to show usage for</p>
          </div>

          <div v-else class="usage-table-container">
            <table class="usage-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Total Calls</th>
                  <th>Tokens In</th>
                  <th>Tokens Out</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in projectUsages" :key="item.project.id">
                  <td>
                    <router-link
                      :to="`/projects/${item.project.id}/tickets`"
                      class="project-link"
                    >
                      {{ item.project.name }}
                    </router-link>
                  </td>
                  <td>{{ item.usage?.totals?.totalCalls || 0 }}</td>
                  <td>{{ item.usage?.totals?.totalTokensIn?.toLocaleString() || 0 }}</td>
                  <td>{{ item.usage?.totals?.totalTokensOut?.toLocaleString() || 0 }}</td>
                  <td>${{ (item.usage?.totals?.totalCost || 0).toFixed(4) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section-header" style="margin-top: 32px;">
            <h2>Model Pricing Reference</h2>
          </div>

          <div v-if="pricingData.length === 0" class="empty-state">
            <p>No pricing data available</p>
          </div>

          <div v-else class="pricing-table-container">
            <table class="pricing-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input ($/M tokens)</th>
                  <th>Output ($/M tokens)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in pricingData" :key="item.model">
                  <td class="model-name">{{ item.model }}</td>
                  <td>${{ item.pricing?.input?.toFixed(4) || '0.0000' }}</td>
                  <td>${{ item.pricing?.output?.toFixed(4) || '0.0000' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.dashboard h1 {
  margin: 0 0 8px 0;
  font-size: 28px;
  color: #1f2937;
}

.welcome {
  margin: 0 0 24px 0;
  color: #6b7280;
  font-size: 16px;
}

.loading, .error {
  padding: 60px 20px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #1f2937;
}

.stat-label {
  font-size: 14px;
  color: #6b7280;
  margin-top: 4px;
}

.section {
  margin-top: 32px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h2 {
  font-size: 20px;
  color: #1f2937;
  margin: 0;
}

.view-all {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
}

.view-all:hover {
  text-decoration: underline;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.empty-state p {
  color: #6b7280;
  margin: 0 0 16px 0;
}

.btn-create {
  display: inline-block;
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}

.btn-create:hover {
  background: #2563eb;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.project-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.project-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.project-info h3 {
  margin: 0 0 8px 0;
  color: #1f2937;
  font-size: 16px;
}

.project-info p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.4;
}

.no-desc {
  color: #9ca3af;
  font-style: italic;
}

.project-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
  font-size: 13px;
  color: #9ca3af;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 2px solid #e5e7eb;
  padding-bottom: 0;
}

.tab {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  color: #6b7280;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  color: #3b82f6;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.usage-table-container,
.pricing-table-container {
  overflow-x: auto;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.usage-table,
.pricing-table {
  width: 100%;
  border-collapse: collapse;
}

.usage-table th,
.usage-table td,
.pricing-table th,
.pricing-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

.usage-table th,
.pricing-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.usage-table td,
.pricing-table td {
  color: #1f2937;
  font-size: 14px;
}

.usage-table tr:last-child td,
.pricing-table tr:last-child td {
  border-bottom: none;
}

.model-name {
  font-weight: 500;
  color: #1f2937;
}

.project-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 500;
}

.project-link:hover {
  text-decoration: underline;
}
</style>
