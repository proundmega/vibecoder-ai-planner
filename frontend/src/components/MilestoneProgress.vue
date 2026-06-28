<template>
  <div class="milestone-progress">
    <div class="milestone-header">
      <strong>{{ milestone.name }}</strong>
      <span v-if="milestone.target_date" class="text-muted">Target: {{ milestone.target_date }}</span>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" :style="{ width: progress.percentage + '%' }"></div>
    </div>
    <div class="progress-text">
      {{ progress.completedEstimate }} / {{ progress.totalEstimate }} points ({{ progress.percentage }}%)
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Milestone, MilestoneProgress } from '../api/milestones'
defineProps<{ milestone: Milestone; progress: MilestoneProgress }>()
</script>

<style scoped>
.milestone-progress {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.milestone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.text-muted {
  color: #6b7280;
  font-size: 0.875rem;
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
}

.progress-text {
  margin-top: 8px;
  font-size: 0.875rem;
  color: #4b5563;
}
</style>
