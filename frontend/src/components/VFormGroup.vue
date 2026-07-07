<template>
  <div class="v-form-group" :class="{ 'v-form-group--error': error, 'v-form-group--required': required }">
    <label v-if="label" class="v-form-group__label">
      <slot name="label">
        {{ label }}
        <span v-if="required" class="required">*</span>
      </slot>
    </label>
    <div class="v-form-group__control">
      <slot />
    </div>
    <span v-if="error" class="v-form-group__error">{{ error }}</span>
    <span v-else-if="helpText" class="v-form-group__help">{{ helpText }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label?: string
  error?: string
  helpText?: string
  required?: boolean
}>()
</script>

<style scoped>
.v-form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.v-form-group__label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text);
}

.required {
  color: var(--color-danger);
  margin-left: 2px;
}

.v-form-group__control {
  display: flex;
  flex-direction: column;
}

.v-form-group__error {
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}

.v-form-group__help {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.v-form-group--error .v-form-group__control input,
.v-form-group--error .v-form-group__control select,
.v-form-group--error .v-form-group__control textarea {
  border-color: var(--color-danger);
}
</style>
