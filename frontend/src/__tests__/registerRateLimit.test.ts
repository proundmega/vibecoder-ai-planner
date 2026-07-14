import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import Register from '@/views/Register.vue'
import { useRateLimitStore } from '@/stores/rateLimit'

vi.mock('@/api/auth', () => ({
  registerUser: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  get: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(() => ({
    token: { value: null },
    setToken: vi.fn(),
    setUser: vi.fn(),
    logout: vi.fn(),
    setPermissions: vi.fn(),
    syncPermissions: vi.fn(),
  })),
}))

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

describe('Register.vue - Rate Limit Disabled State', () => {
  let wrapper: VueWrapper<any>

  beforeEach(() => {
    vi.clearAllMocks()
    wrapper = mount(Register, {
      global: {
        stubs: { 'router-link': { template: '<span><slot /></span>' } },
      },
    })
  })

  it('inputs are NOT disabled when rate limit is inactive', () => {
    const inputs = wrapper.findAll('input')
    inputs.forEach(input => {
      expect(input.attributes('disabled')).toBeUndefined()
    })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('inputs ARE disabled when rate limit is active', async () => {
    const rateLimitStore = useRateLimitStore()
    rateLimitStore.rateLimitActive.value = true
    
    await wrapper.vm.$nextTick()
    
    const inputs = wrapper.findAll('input')
    inputs.forEach(input => {
      expect(input.attributes('disabled')).toBeDefined()
    })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('form has disabled class when rate limit is active', async () => {
    const rateLimitStore = useRateLimitStore()
    rateLimitStore.rateLimitActive.value = true
    
    await wrapper.vm.$nextTick()
    
    const form = wrapper.find('form')
    expect(form.classes()).toContain('register__form--disabled')
  })
})
