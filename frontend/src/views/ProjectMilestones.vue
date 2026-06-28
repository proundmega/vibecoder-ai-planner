<template>
  <div class="project-milestones">
    <div class="header">
      <h2>Milestones</h2>
      <button class="btn btn-primary" @click="showNewModal = true">New Milestone</button>
    </div>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else>
      <div v-if="milestones.length === 0" class="empty-state">
        <p>No milestones yet. Create your first milestone to track project progress.</p>
      </div>

      <div v-else class="milestones-list">
        <div
          v-for="milestone in milestones"
          :key="milestone.id"
          class="milestone-card"
          :class="{ active: milestone.is_active }"
          @click="selectMilestone(milestone)"
        >
          <div class="milestone-info">
            <h3>{{ milestone.name }}</h3>
            <p v-if="milestone.description" class="description">{{ milestone.description }}</p>
            <div class="meta">
              <span v-if="milestone.target_date" class="target-date">
                Target: {{ formatDate(milestone.target_date) }}
              </span>
              <span class="status" :class="milestone.is_active ? 'active' : 'inactive'">
                {{ milestone.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>
          </div>

          <div v-if="selectedMilestone?.id === milestone.id" class="milestone-details">
            <MilestoneProgress
              v-if="progress"
              :milestone="milestone"
              :progress="progress"
            />

            <div v-if="tickets.length > 0" class="tickets-section">
              <h4>Tickets ({{ tickets.length }})</h4>
              <div class="ticket-list">
                <div
                  v-for="ticket in tickets"
                  :key="ticket.id"
                  class="ticket-item"
                >
                  <span class="ticket-title">{{ ticket.title }}</span>
                  <span class="ticket-status" :class="ticket.status">{{ ticket.status }}</span>
                  <span v-if="ticket.estimate" class="ticket-estimate">{{ ticket.estimate }}pts</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <NewMilestoneModal
      v-if="showNewModal"
      :project-id="projectId"
      @close="showNewModal = false"
      @created="onMilestoneCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { listMilestones, getMilestoneProgress, getMilestoneTickets } from '../api/milestones'
import type { Milestone, MilestoneProgress as MilestoneProgressType } from '../api/milestones'
import MilestoneProgress from '../components/MilestoneProgress.vue'
import NewMilestoneModal from '../components/NewMilestoneModal.vue'

const route = useRoute()
const projectId = computed(() => route.params.id as string)

const milestones = ref<Milestone[]>([])
const loading = ref(false)
const selectedMilestone = ref<Milestone | null>(null)
const progress = ref<MilestoneProgressType | null>(null)
const tickets = ref<any[]>([])
const showNewModal = ref(false)

async function fetchMilestones() {
  loading.value = true
  try {
    milestones.value = await listMilestones(projectId.value)
  } catch (err) {
    console.error('Failed to fetch milestones:', err)
  } finally {
    loading.value = false
  }
}

async function selectMilestone(milestone: Milestone) {
  selectedMilestone.value = milestone
  try {
    progress.value = await getMilestoneProgress(milestone.id)
    tickets.value = await getMilestoneTickets(milestone.id)
  } catch (err) {
    console.error('Failed to fetch milestone details:', err)
  }
}

async function onMilestoneCreated() {
  showNewModal.value = false
  await fetchMilestones()
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString()
}

onMounted(fetchMilestones)
</script>

<style scoped>
.project-milestones {
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

.milestones-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.milestone-card {
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.milestone-card:hover {
  border-color: #3b82f6;
  background: #f0f7ff;
}

.milestone-card.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.milestone-info h3 {
  margin: 0 0 8px;
  color: #111827;
}

.description {
  margin: 0 0 12px;
  color: #6b7280;
  font-size: 0.875rem;
}

.meta {
  display: flex;
  gap: 16px;
  font-size: 0.875rem;
}

.target-date {
  color: #4b5563;
}

.status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status.active {
  background: #dcfce7;
  color: #166534;
}

.status.inactive {
  background: #f3f4f6;
  color: #6b7280;
}

.milestone-details {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.tickets-section {
  margin-top: 16px;
}

.tickets-section h4 {
  margin: 0 0 12px;
  color: #374151;
}

.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ticket-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f9fafb;
  border-radius: 6px;
  font-size: 0.875rem;
}

.ticket-title {
  flex: 1;
  color: #111827;
}

.ticket-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.ticket-status.done {
  background: #dcfce7;
  color: #166534;
}

.ticket-status.in_progress {
  background: #dbeafe;
  color: #1e40af;
}

.ticket-status.review {
  background: #fef3c7;
  color: #92400e;
}

.ticket-status.backlog {
  background: #f3f4f6;
  color: #6b7280;
}

.ticket-estimate {
  color: #6b7280;
  font-size: 0.75rem;
}
</style>
