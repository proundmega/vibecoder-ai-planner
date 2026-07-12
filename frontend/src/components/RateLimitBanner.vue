<template>
  <div v-if="active" class="rate-limit-banner">
    <svg class="rate-limit-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
    <span>Too many requests. Try again in {{ minutes }}m {{ seconds }}s.</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRateLimitStore } from '@/stores/rateLimit'

const rateLimitStore = useRateLimitStore()

const minutes = computed(() => Math.floor(Number(rateLimitStore.countdownSeconds) / 60))
const seconds = computed(() => Number(rateLimitStore.countdownSeconds) % 60)
const active = computed(() => rateLimitStore.rateLimitActive)
</script>

<style scoped>
.rate-limit-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 0.5rem;
  color: #92400e;
  font-size: 0.875rem;
}

.rate-limit-icon {
  flex-shrink: 0;
}
</style>
