<template>
  <div class="v-empty-state">
    <div v-if="$slots.icon" class="v-empty-state__icon">
      <slot name="icon" />
    </div>
    <h3 v-if="title" class="v-empty-state__title">{{ title }}</h3>
    <p v-if="description" class="v-empty-state__description">{{ description }}</p>
    <div v-if="$slots.actions" class="v-empty-state__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
}>()
</script>

<style scoped>
.v-empty-state {
  text-align: center;
  padding: var(--spacing-2xl) var(--spacing-lg);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.v-empty-state__icon {
  margin-bottom: var(--spacing-md);
  color: var(--color-text-muted);
}

.v-empty-state__title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: var(--spacing-sm);
}

.v-empty-state__description {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
  margin-bottom: var(--spacing-lg);
}

.v-empty-state__actions {
  display: flex;
  justify-content: center;
  gap: var(--spacing-sm);
}
</style>
