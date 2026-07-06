<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="v-modal-overlay"
      :class="{ 'v-modal-overlay--animate': animate }"
      @click.self="closeOnOverlay && close()"
    >
      <div
        class="v-modal"
        :class="[`v-modal--${size}`]"
        role="dialog"
        aria-modal="true"
        @keydown.escape="close"
      >
        <div v-if="$slots.header || title" class="v-modal__header">
          <slot name="header">
            <h3 class="v-modal__title">{{ title }}</h3>
          </slot>
          <button v-if="closable" class="v-modal__close" @click="close">&times;</button>
        </div>
        <div class="v-modal__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="v-modal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, onUnmounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  size?: 'small' | 'medium' | 'large' | 'fullscreen'
  closeOnOverlay?: boolean
  closable?: boolean
  animate?: boolean
}>(), {
  title: '',
  size: 'medium',
  closeOnOverlay: true,
  closable: true,
  animate: true
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

function close() {
  emit('update:modelValue', false)
  emit('close')
}

const lastFocusedElement = ref<HTMLElement | null>(null)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      lastFocusedElement.value = document.activeElement as HTMLElement
      document.body.style.overflow = 'hidden'
      // Focus the modal
      setTimeout(() => {
        const modal = document.querySelector('.v-modal') as HTMLElement
        if (modal) modal.focus()
      }, 100)
    } else {
      document.body.style.overflow = ''
      // Restore focus
      if (lastFocusedElement.value) {
        lastFocusedElement.value.focus()
      }
    }
  }
)

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<style scoped>
.v-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.v-modal-overlay--animate {
  animation: fadeIn 0.15s ease-out;
}

.v-modal {
  background: var(--color-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.v-modal--small {
  width: 400px;
}

.v-modal--medium {
  width: 600px;
}

.v-modal--large {
  width: 800px;
}

.v-modal--fullscreen {
  width: 95vw;
  height: 95vh;
}

.v-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
}

.v-modal__title {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.v-modal__close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color var(--transition-fast);
}

.v-modal__close:hover {
  color: var(--color-text);
}

.v-modal__body {
  padding: var(--spacing-lg);
  overflow-y: auto;
  flex: 1;
}

.v-modal__footer {
  padding: var(--spacing-lg);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
