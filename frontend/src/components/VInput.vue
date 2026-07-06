<template>
  <div class="v-input" :class="[`v-input--${size}`, { 'v-input--error': !!error, 'v-input--disabled': disabled }]">
    <label v-if="label" class="v-input__label" :for="id">
      {{ label }}
      <span v-if="required" class="v-input__required">*</span>
    </label>
    <div class="v-input__wrapper">
      <span v-if="$slots.prefix" class="v-input__prefix">
        <slot name="prefix" />
      </span>
      <input
        :id="id"
        v-bind="$attrs"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        class="v-input__field"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @change="$emit('change', $event)"
      />
      <span v-if="$slots.suffix" class="v-input__suffix">
        <slot name="suffix" />
      </span>
    </div>
    <p v-if="error" class="v-input__error">{{ error }}</p>
    <p v-else-if="help" class="v-input__help">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

defineProps<{
  modelValue?: string
  label?: string
  type?: string
  placeholder?: string
  error?: string
  help?: string
  disabled?: boolean
  required?: boolean
  size?: 'small' | 'medium' | 'large'
}>()

defineEmits<{
  'update:modelValue': [value: string]
  change: [event: Event]
}>()

const id = computed(() => `v-input-${Math.random().toString(36).substr(2, 9)}`)
</script>

<style scoped>
.v-input {
  width: 100%;
}

.v-input__label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: var(--spacing-xs);
}

.v-input__required {
  color: var(--color-danger);
  margin-left: var(--spacing-xs);
}

.v-input__wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.v-input__prefix,
.v-input__suffix {
  position: absolute;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  pointer-events: none;
}

.v-input__prefix {
  left: var(--spacing-sm);
}

.v-input__suffix {
  right: var(--spacing-sm);
}

.v-input__field {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  color: var(--color-text);
  background: var(--color-bg);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.v-input__field:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.v-input--error .v-input__field {
  border-color: var(--color-danger);
}

.v-input--error .v-input__field:focus {
  box-shadow: 0 0 0 3px var(--color-danger-light);
}

.v-input--disabled .v-input__field {
  background: var(--color-bg-tertiary);
  cursor: not-allowed;
  opacity: 0.6;
}

.v-input__error {
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  margin-top: var(--spacing-xs);
}

.v-input__help {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-top: var(--spacing-xs);
}

.v-input--small .v-input__field {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-sm);
}

.v-input--large .v-input__field {
  padding: var(--spacing-md) var(--spacing-lg);
  font-size: var(--font-size-lg);
}
</style>
