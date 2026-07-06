import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import VModal from '@/components/VModal.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('VModal', () => {
  it('does not render when modelValue is false', () => {
    mount(VModal, { props: { modelValue: false }, slots: { default: 'Content' } })
    expect(document.body.querySelector('.v-modal-overlay')).toBeNull()
  })

  it('renders when modelValue is true', () => {
    mount(VModal, { props: { modelValue: true }, slots: { default: 'Content' } })
    expect(document.body.querySelector('.v-modal-overlay')).not.toBeNull()
    expect(document.body.querySelector('.v-modal__body')?.textContent).toBe('Content')
  })

  it('displays title', () => {
    mount(VModal, { props: { modelValue: true, title: 'Test Modal' } })
    expect(document.body.querySelector('.v-modal__title')?.textContent).toBe('Test Modal')
  })

  it('applies small size class', () => {
    mount(VModal, { props: { modelValue: true, size: 'small' } })
    expect(document.body.querySelector('.v-modal--small')).not.toBeNull()
  })

  it('applies medium size class', () => {
    mount(VModal, { props: { modelValue: true, size: 'medium' } })
    expect(document.body.querySelector('.v-modal--medium')).not.toBeNull()
  })

  it('applies large size class', () => {
    mount(VModal, { props: { modelValue: true, size: 'large' } })
    expect(document.body.querySelector('.v-modal--large')).not.toBeNull()
  })

  it('applies fullscreen size class', () => {
    mount(VModal, { props: { modelValue: true, size: 'fullscreen' } })
    expect(document.body.querySelector('.v-modal--fullscreen')).not.toBeNull()
  })

  it('closes on overlay click', async () => {
    const wrapper = mount(VModal, { props: { modelValue: true } })
    await document.body.querySelector('.v-modal-overlay')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([false])
  })

  it('does not close on overlay click when closeOnOverlay is false', async () => {
    const wrapper = mount(VModal, { props: { modelValue: true, closeOnOverlay: false } })
    await document.body.querySelector('.v-modal-overlay')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('emits close event on close button click', async () => {
    const wrapper = mount(VModal, { props: { modelValue: true } })
    await document.body.querySelector('.v-modal__close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not render close button when closable is false', () => {
    mount(VModal, { props: { modelValue: true, closable: false } })
    expect(document.body.querySelector('.v-modal__close')).toBeNull()
  })

  it('renders header slot content', () => {
    mount(VModal, {
      props: { modelValue: true },
      slots: { header: '<div class="custom-header">Custom</div>' }
    })
    expect(document.body.querySelector('.custom-header')).not.toBeNull()
  })

  it('renders footer slot content', () => {
    mount(VModal, {
      props: { modelValue: true },
      slots: { footer: '<div class="custom-footer">Footer</div>' }
    })
    expect(document.body.querySelector('.custom-footer')).not.toBeNull()
  })
})
