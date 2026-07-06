import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VButton from '@/components/VButton.vue'

describe('VButton', () => {
  it('renders with default props', () => {
    const wrapper = mount(VButton, { slots: { default: 'Click me' } })
    expect(wrapper.text()).toBe('Click me')
    expect(wrapper.classes()).toContain('v-btn')
    expect(wrapper.classes()).toContain('v-btn--primary')
    expect(wrapper.classes()).toContain('v-btn--medium')
  })

  it('applies correct variant classes', () => {
    const variants = ['primary', 'secondary', 'danger', 'ghost', 'link']
    variants.forEach((variant) => {
      const wrapper = mount(VButton, { props: { variant }, slots: { default: 'Button' } })
      expect(wrapper.classes()).toContain(`v-btn--${variant}`)
    })
  })

  it('applies correct size classes', () => {
    const sizes = ['small', 'medium', 'large']
    sizes.forEach((size) => {
      const wrapper = mount(VButton, { props: { size }, slots: { default: 'Button' } })
      expect(wrapper.classes()).toContain(`v-btn--${size}`)
    })
  })

  it('shows spinner when loading', () => {
    const wrapper = mount(VButton, { props: { loading: true }, slots: { default: 'Loading' } })
    expect(wrapper.find('.v-btn__spinner').exists()).toBe(true)
    expect(wrapper.classes()).toContain('v-btn--loading')
  })

  it('is disabled when disabled prop is true', () => {
    const wrapper = mount(VButton, { props: { disabled: true }, slots: { default: 'Disabled' } })
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.classes()).toContain('v-btn--disabled')
  })

  it('applies full-width class when fullWidth is true', () => {
    const wrapper = mount(VButton, { props: { fullWidth: true }, slots: { default: 'Wide' } })
    expect(wrapper.classes()).toContain('v-btn--full-width')
  })

  it('emits click event', async () => {
    const wrapper = mount(VButton, { slots: { default: 'Click' } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeTruthy()
  })

  it('does not emit click when disabled', async () => {
    const wrapper = mount(VButton, { props: { disabled: true }, slots: { default: 'Click' } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeFalsy()
  })

  it('does not emit click when loading', async () => {
    const wrapper = mount(VButton, { props: { loading: true }, slots: { default: 'Click' } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeFalsy()
  })
})
