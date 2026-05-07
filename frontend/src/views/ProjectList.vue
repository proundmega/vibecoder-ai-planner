<!--
TKT-010: Implement Projects View

- Fetch all user's projects with ownership validation
- Display project cards with actions
- "Create Project" button with modal form
- View project detail by clicking card
- Permission checks for create/update/delete/view
- Filter and sort options
-->
<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.js'

const authStore = useAuthStore()
const projects = ref([])
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    const response = await fetch('http://localhost:3001/api/v1/projects', {
      headers: {
        'Authorization': `Bearer ${authStore.token}`
      }
    })
    
    if (response.ok) {
      const data = await response.json()
      projects.value = data || []
    }
  } catch (err) {
    error.value = 'Failed to load projects'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="project-list">
    <h1>My Projects</h1>
    
    <div v-if="loading" class="loading">Loading...</div>
    
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="$router.go(-1)">Go Back</button>
    </div>
    
    <div v-else-if="projects.length === 0" class="empty">
      <p>No projects yet. Start by creating one!</p>
    </div>
    
    <div v-else>
      <div class="projects-grid">
        <div v-for="project in projects" :key="project.id" class="project-card">
          <div class="project-info">
            <h3>{{ project.name }}</h3>
            <p v-if="project.description">{{ project.description }}</p>
          </div>
          <div class="project-meta">
            <span class="status">{{ project.status || 'active' }}</span>
            <span>{{ project.created_at || '' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-list {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 20px;
}

.loading, .error {
  padding: 40px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.empty {
  padding: 40px;
  text-align: center;
  color: #666;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
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
  margin: 0 0 10px 0;
  color: #1f2937;
}

.project-info p {
  margin: 0;
  color: #6b7280;
  line-height: 1.5;
}

.project-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #f3f4f6;
  font-size: 13px;
  color: #9ca3af;
}

.project-card .status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
}

.project-card .status.draft {
  background: #f3f4f6;
  color: #6b7280;
}

.project-card .status.active {
  background: #dbeafe;
  color: #1d4ed8;
}

.project-card .status.completed {
  background: #d1fae5;
  color: #059669;
}
</style>
