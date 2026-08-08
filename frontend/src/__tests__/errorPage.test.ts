import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorPage from '@/views/ErrorPage.vue'

vi.mock('vue-router', () => ({
  useRoute: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

import { useRoute } from 'vue-router'

describe('ErrorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders 404 title by default', () => {
    vi.mocked(useRoute).mockReturnValue({ query: { error: '404' } } as ReturnType<typeof useRoute>)
    const wrapper = mount(ErrorPage)
    expect(wrapper.text()).toContain('Page Not Found')
  })

  it('renders 500 title when ?error=500', () => {
    vi.mocked(useRoute).mockReturnValue({ query: { error: '500' } } as ReturnType<typeof useRoute>)
    const wrapper = mount(ErrorPage)
    expect(wrapper.text()).toContain('Internal Server Error')
  })

  it('renders 404 title with no error query param', () => {
    vi.mocked(useRoute).mockReturnValue({ query: {} } as ReturnType<typeof useRoute>)
    const wrapper = mount(ErrorPage)
    expect(wrapper.text()).toContain('Page Not Found')
  })

  it('has Go to Dashboard button', () => {
    vi.mocked(useRoute).mockReturnValue({ query: {} } as ReturnType<typeof useRoute>)
    const wrapper = mount(ErrorPage)
    expect(wrapper.find('button').text()).toBe('Go to Dashboard')
  })
})
