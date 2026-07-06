<template>
  <button
    :class="[
      'v-btn',
      `v-btn--${variant}`,
      `v-btn--${size}`,
      { 'v-btn--loading': loading, 'v-btn--disabled': disabled, 'v-btn--full-width': fullWidth }
    ]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="v-btn__spinner" />
    <span v-if="$slots.default" class="v-btn__content">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
  size?: 'small' | 'medium' | 'large'
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
}>()

defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.v-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-family);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  line-height: 1;
  white-space: nowrap;
}

.v-btn--primary {
  background: var(--color-primary);
  color: white;
}

.v-btn--primary:hover:not(.v-btn--loading):not(.v-btn--disabled) {
  background: var(--color-primary-hover);
}

.v-btn--secondary {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.v-btn--secondary:hover:not(.v-btn--loading):not(.v-btn--disabled) {
  background: var(--color-bg-secondary);
}

.v-btn--danger {
  background: var(--color-danger);
  color: white;
}

.v-btn--danger:hover:not(.v-btn--loading):not(.v-btn--disabled) {
  background: var(--color-danger-hover);
}

.v-btn--ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.v-btn--ghost:hover:not(.v-btn--loading):not(.v-btn--disabled) {
  background: var(--color-bg-secondary);
}

.v-btn--link {
  background: transparent;
  color: var(--color-primary);
  text-decoration: underline;
}

.v-btn--small {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-sm);
}

.v-btn--medium {
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-base);
}

.v-btn--large {
  padding: var(--spacing-md) var(--spacing-lg);
  font-size: var(--font-size-lg);
}

.v-btn--loading {
  opacity: 0.7;
  cursor: not-allowed;
}

.v-btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.v-btn--full-width {
  width: 100%;
}

.v-btn__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.v-btn--secondary .v-btn__spinner,
.v-btn--ghost .v-btn__spinner {
  border-color: rgba(0, 0, 0, 0.1);
  border-top-color: var(--color-text);
}

.v-btn__content {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
