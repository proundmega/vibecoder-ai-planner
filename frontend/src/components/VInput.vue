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
      <textarea
        v-if="type === 'textarea'"
        :id="id"
        v-bind="$attrs"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :rows="rows || 4"
        class="v-input__field"
        data-type="textarea"
        @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @change="$emit('change', $event)"
      />
      <select
        v-else-if="type === 'select'"
        :id="id"
        v-bind="$attrs"
        :value="modelValue"
        :disabled="disabled"
        :required="required"
        class="v-input__field"
        data-type="select"
        @change="handleChange"
      >
        <slot />
      </select>
      <input
        v-else
        :id="id"
        v-bind="$attrs"
        :type="type || 'text'"
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

withDefaults(defineProps<{
  modelValue?: string
  label?: string
  type?: 'text' | 'email' | 'password' | 'textarea' | 'select' | 'number' | 'date'
  placeholder?: string
  error?: string
  help?: string
  disabled?: boolean
  required?: boolean
  size?: 'small' | 'medium' | 'large'
  rows?: number
}>(), {
  modelValue: '',
  label: '',
  type: 'text',
  placeholder: '',
  error: '',
  help: '',
  disabled: false,
  required: false,
  size: 'medium',
  rows: 4
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [event: Event]
}>()

const id = computed(() => `v-input-${Math.random().toString(36).substr(2, 9)}`)

function handleChange(event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
  emit('change', event)
}
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

.v-input__field[data-type='textarea'] {
  resize: vertical;
  min-height: 80px;
}

.v-input__field[data-type='select'] {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--spacing-sm) center;
  padding-right: var(--spacing-xl);
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
