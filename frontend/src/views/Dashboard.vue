<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchProjects } from '@/api/projects'

const authStore = useAuthStore()
const router = useRouter()
const projects = ref([])
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    projects.value = await fetchProjects(authStore.token.value)
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
    error.value = 'Failed to load dashboard data'
  } finally {
    loading.value = false
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

      <div class="section">
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
</style>
