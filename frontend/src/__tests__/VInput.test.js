import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VInput from '@/components/VInput.vue'

describe('VInput', () => {
  it('renders input field with label', () => {
    const wrapper = mount(VInput, { props: { modelValue: 'test', label: 'Label' } })
    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.find('.v-input__label').text()).toBe('Label')
  })

  it('displays error message', () => {
    const wrapper = mount(VInput, { props: { error: 'Error text' } })
    expect(wrapper.find('.v-input__error').text()).toBe('Error text')
    expect(wrapper.classes()).toContain('v-input--error')
  })

  it('displays help text', () => {
    const wrapper = mount(VInput, { props: { help: 'Help text' } })
    expect(wrapper.find('.v-input__help').text()).toBe('Help text')
  })

  it('is disabled when disabled prop is true', () => {
    const wrapper = mount(VInput, { props: { disabled: true } })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.classes()).toContain('v-input--disabled')
  })

  it('emits update:modelValue on input', async () => {
    const wrapper = mount(VInput, { props: { modelValue: 'test' } })
    await wrapper.find('input').setValue('new value')
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['new value'])
  })

  it('emits change event', async () => {
    const wrapper = mount(VInput, { props: { modelValue: 'test' } })
    await wrapper.find('input').trigger('change')
    expect(wrapper.emitted('change')).toBeTruthy()
  })

  it('generates unique id', () => {
    const wrapper = mount(VInput, { props: { label: 'Test' } })
    const input = wrapper.find('input')
    expect(input.attributes('id')).toBeDefined()
    expect(input.attributes('id')).toMatch(/^v-input-/)
  })

  it('applies size classes', () => {
    const sizes = ['small', 'medium', 'large']
    sizes.forEach((size) => {
      const wrapper = mount(VInput, { props: { size } })
      expect(wrapper.classes()).toContain(`v-input--${size}`)
    })
  })
})
