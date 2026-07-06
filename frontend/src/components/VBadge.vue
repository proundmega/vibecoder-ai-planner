<template>
  <span
    class="v-badge"
    :class="[`v-badge--${color}`, `v-badge--${size}`, { 'v-badge--dot': dot }]"
  >
    <slot />
    <span v-if="showBadge" class="v-badge__indicator" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue?: boolean
  color?: 'default' | 'primary' | 'danger' | 'success' | 'warning' | 'info'
  size?: 'small' | 'medium' | 'large'
  dot?: boolean
}>()

const showBadge = computed(() => props.modelValue !== false)
</script>

<style scoped>
.v-badge {
  position: relative;
  display: inline-flex;
}

.v-badge__indicator {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--color-danger);
  border: 2px solid var(--color-bg);
  border-radius: 50%;
}

.v-badge--dot .v-badge__indicator {
  width: 8px;
  height: 8px;
}

.v-badge--small .v-badge__indicator {
  width: 6px;
  height: 6px;
}

.v-badge--medium .v-badge__indicator {
  width: 10px;
  height: 10px;
}

.v-badge--large .v-badge__indicator {
  width: 14px;
  height: 14px;
}

.v-badge--primary .v-badge__indicator {
  background: var(--color-primary);
}

.v-badge--success .v-badge__indicator {
  background: var(--color-success);
}

.v-badge--warning .v-badge__indicator {
  background: var(--color-warning);
}

.v-badge--info .v-badge__indicator {
  background: var(--color-info);
}
</style>
