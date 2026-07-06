import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VCard from '@/components/VCard.vue'

describe('VCard', () => {
  it('renders body content', () => {
    const wrapper = mount(VCard, { slots: { default: 'Body content' } })
    expect(wrapper.find('.v-card__body').text()).toBe('Body content')
  })

  it('applies padding classes', () => {
    const paddings = ['none', 'small', 'medium', 'large']
    paddings.forEach((padding) => {
      const wrapper = mount(VCard, { props: { padding } })
      expect(wrapper.classes()).toContain(`v-card--${padding}`)
    })
  })

  it('renders header slot', () => {
    const wrapper = mount(VCard, { slots: { header: '<div>Header</div>' } })
    expect(wrapper.find('.v-card__header').text()).toBe('Header')
  })

  it('renders footer slot', () => {
    const wrapper = mount(VCard, { slots: { footer: '<div>Footer</div>' } })
    expect(wrapper.find('.v-card__footer').text()).toBe('Footer')
  })

  it('applies hover class when hover is true', () => {
    const wrapper = mount(VCard, { props: { hover: true } })
    expect(wrapper.classes()).toContain('v-card--hover')
  })
})
