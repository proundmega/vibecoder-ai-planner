import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VEmptyState from '@/components/VEmptyState.vue'

describe('VEmptyState', () => {
  it('renders title', () => {
    const wrapper = mount(VEmptyState, { props: { title: 'No items' } })
    expect(wrapper.find('.v-empty-state__title').text()).toBe('No items')
  })

  it('renders description', () => {
    const wrapper = mount(VEmptyState, { props: { description: 'No items found' } })
    expect(wrapper.find('.v-empty-state__description').text()).toBe('No items found')
  })

  it('renders icon slot', () => {
    const wrapper = mount(VEmptyState, { slots: { icon: '<div class="custom-icon" />' } })
    expect(wrapper.find('.custom-icon').exists()).toBe(true)
  })

  it('renders actions slot', () => {
    const wrapper = mount(VEmptyState, { slots: { actions: '<div class="actions" />' } })
    expect(wrapper.find('.actions').exists()).toBe(true)
  })

  it('does not render title when not provided', () => {
    const wrapper = mount(VEmptyState)
    expect(wrapper.find('.v-empty-state__title').exists()).toBe(false)
  })

  it('does not render description when not provided', () => {
    const wrapper = mount(VEmptyState)
    expect(wrapper.find('.v-empty-state__description').exists()).toBe(false)
  })
})
