import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VFormGroup from '@/components/VFormGroup.vue'

describe('VFormGroup', () => {
  it('renders label text', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email' },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.v-form-group__label').text()).toBe('Email')
  })

  it('renders required asterisk when required is true', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email', required: true },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.required').exists()).toBe(true)
    expect(wrapper.find('.required').text()).toBe('*')
  })

  it('renders error text when error prop is set', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email', error: 'Invalid email' },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.v-form-group__error').text()).toBe('Invalid email')
  })

  it('applies error class when error prop is set', () => {
    const wrapper = mount(VFormGroup, {
      props: { error: 'Invalid email' },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.classes()).toContain('v-form-group--error')
  })

  it('does not show error when error prop is empty', () => {
    const wrapper = mount(VFormGroup, {
      props: { error: '' },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.v-form-group__error').exists()).toBe(false)
  })

  it('renders help text when provided', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email', helpText: 'We will never share your email' },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.v-form-group__help').text()).toBe('We will never share your email')
  })

  it('does not show help text when error is present', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email', error: 'Invalid', helpText: 'Help text' },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.v-form-group__error').exists()).toBe(true)
    expect(wrapper.find('.v-form-group__help').exists()).toBe(false)
  })

  it('renders slot content in control area', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email' },
      slots: { default: '<input type="email" class="my-input" />' }
    })
    expect(wrapper.find('.my-input').exists()).toBe(true)
  })

  it('renders custom label slot', () => {
    const wrapper = mount(VFormGroup, {
      props: { label: 'Email' },
      slots: {
        default: '<input type="email" />',
        label: '<span class="custom-label">Custom Label</span>'
      }
    })
    expect(wrapper.find('.custom-label').text()).toBe('Custom Label')
  })

  it('does not render label when not provided', () => {
    const wrapper = mount(VFormGroup, {
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.find('.v-form-group__label').exists()).toBe(false)
  })

  it('applies required class when required is true', () => {
    const wrapper = mount(VFormGroup, {
      props: { required: true },
      slots: { default: '<input type="email" />' }
    })
    expect(wrapper.classes()).toContain('v-form-group--required')
  })
})
