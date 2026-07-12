import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentModal from '@/components/AgentModal.vue'

describe('AgentModal', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    container.id = 'modal-test-container'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  const mountOptions = {
    global: {
      stubs: { Teleport: { template: '<div><slot /></div>' } },
    },
  }

  it('renders name input when show is true', () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.find('.v-modal__title').text()).toBe('Create Agent')
  })

  it('is not rendered when show is false', () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: false }, attachTo: container })
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('emits submit with trimmed name and null provider', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    await wrapper.find('input').setValue('  My Agent  ')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('created')).toBeTruthy()
    expect(wrapper.emitted('created')[0]).toEqual(['My Agent', null])
  })

  it('shows error when submitting empty name', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('created')).toBeFalsy()
    expect(wrapper.find('.v-input__error').text()).toBe('Name is required')
  })

  it('shows error when name exceeds 100 characters', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    await wrapper.find('input').setValue('a'.repeat(101))
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('created')).toBeFalsy()
    expect(wrapper.find('.v-input__error').text()).toBe('Name must be 100 characters or less')
  })

  it('emits update:show false on cancel', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    await wrapper.find('.v-btn--secondary').trigger('click')
    expect(wrapper.emitted('update:show')).toBeTruthy()
    expect(wrapper.emitted('update:show')[0]).toEqual([false])
  })

  it('emits update:show false on close button click', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    await wrapper.find('.v-modal__close').trigger('click')
    expect(wrapper.emitted('update:show')).toBeTruthy()
    expect(wrapper.emitted('update:show')[0]).toEqual([false])
  })

  it('disables submit button when loading', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    await wrapper.find('input').setValue('Agent')
    await wrapper.find('form').trigger('submit')
    const btn = wrapper.find('button[type="submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('disables submit button when name is empty', async () => {
    const wrapper = mount(AgentModal, { ...mountOptions, props: { show: true }, attachTo: container })
    const btn = wrapper.find('button[type="submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })
})
