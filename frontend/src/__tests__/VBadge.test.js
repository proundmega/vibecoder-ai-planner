import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VBadge from '@/components/VBadge.vue'

describe('VBadge', () => {
  it('does not show indicator when modelValue is false', () => {
    const wrapper = mount(VBadge, { props: { modelValue: false }, slots: { default: 'Content' } })
    expect(wrapper.find('.v-badge__indicator').exists()).toBe(false)
  })

  it('shows indicator when modelValue is true', () => {
    const wrapper = mount(VBadge, { props: { modelValue: true }, slots: { default: 'Content' } })
    expect(wrapper.find('.v-badge__indicator').exists()).toBe(true)
  })

  it('shows indicator by default', () => {
    const wrapper = mount(VBadge, { slots: { default: 'Content' } })
    expect(wrapper.find('.v-badge__indicator').exists()).toBe(true)
  })

  it('applies color classes to wrapper', () => {
    const colors = ['default', 'primary', 'danger', 'success', 'warning', 'info']
    colors.forEach((color) => {
      const wrapper = mount(VBadge, { props: { modelValue: true, color } })
      expect(wrapper.classes()).toContain(`v-badge--${color}`)
    })
  })

  it('applies size classes to wrapper', () => {
    const sizes = ['small', 'medium', 'large']
    sizes.forEach((size) => {
      const wrapper = mount(VBadge, { props: { modelValue: true, size } })
      expect(wrapper.classes()).toContain(`v-badge--${size}`)
    })
  })

  it('applies dot class when dot is true', () => {
    const wrapper = mount(VBadge, { props: { modelValue: true, dot: true } })
    expect(wrapper.classes()).toContain('v-badge--dot')
  })

  it('renders slot content', () => {
    const wrapper = mount(VBadge, { slots: { default: 'Badge content' } })
    expect(wrapper.text()).toContain('Badge content')
  })
})
