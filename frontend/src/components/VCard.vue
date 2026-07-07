<template>
  <div
    class="v-card"
    :class="[
      `v-card--${padding}`,
      { 'v-card--hover': hover }
    ]"
  >
    <div v-if="$slots.header" class="v-card__header">
      <slot name="header" />
    </div>
    <div class="v-card__body">
      <slot />
    </div>
    <div v-if="$slots.footer" class="v-card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  padding?: 'none' | 'small' | 'medium' | 'large'
  hover?: boolean
}>(), {
  padding: 'medium',
  hover: false
})
</script>

<style scoped>
.v-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.v-card--hover:hover {
  box-shadow: var(--shadow-md);
}

.v-card__header {
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.v-card__body {
  padding: var(--spacing-lg);
}

.v-card__footer {
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}
</style>
