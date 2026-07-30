import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import CspViolations from '@/views/CspViolations.vue'

const mockCspApi = vi.hoisted(() => ({
  getCspViolations: vi.fn(),
  clearCspViolations: vi.fn(),
}))

vi.mock('@/api/cspViolations', () => ({
  getCspViolations: mockCspApi.getCspViolations,
  clearCspViolations: mockCspApi.clearCspViolations,
}))

const mockViolations = [
  {
    id: 1,
    violated_directive: 'script-src',
    blocked_uri: 'https://evil.com/script.js',
    document_uri: 'https://example.com/page1',
    referrer: 'https://example.com/',
    created_at: '2025-07-12T12:00:00.000Z',
  },
  {
    id: 2,
    violated_directive: 'style-src',
    blocked_uri: 'https://evil.com/style.css',
    document_uri: 'https://example.com/page2',
    referrer: 'https://example.com/',
    created_at: '2025-07-12T11:00:00.000Z',
  },
]

describe('CspViolations.vue', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  async function flushPromises() {
    await nextTick()
    await nextTick()
    await nextTick()
    await nextTick()
  }

  it('loads violations on mount', async () => {
    mockCspApi.getCspViolations.mockResolvedValue({
      violations: mockViolations,
      total: 2,
      limit: 20,
      offset: 0,
    })

    wrapper = mount(CspViolations)
    await flushPromises()

    expect(mockCspApi.getCspViolations).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    expect(wrapper.text()).toContain('script-src')
    expect(wrapper.text()).toContain('style-src')
  })

  it('displays violations in table', async () => {
    mockCspApi.getCspViolations.mockResolvedValue({
      violations: mockViolations,
      total: 2,
      limit: 20,
      offset: 0,
    })

    wrapper = mount(CspViolations)
    await flushPromises()

    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).toContain('https://evil.com/script.js')
    expect(wrapper.text()).toContain('https://example.com/page1')
  })

  it('shows empty state when no violations', async () => {
    mockCspApi.getCspViolations.mockResolvedValue({
      violations: [],
      total: 0,
      limit: 20,
      offset: 0,
    })

    wrapper = mount(CspViolations)
    await flushPromises()

    expect(wrapper.text()).toContain('No violations found')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('filters by directive', async () => {
    mockCspApi.getCspViolations.mockResolvedValue({
      violations: [mockViolations[0]],
      total: 1,
      limit: 20,
      offset: 0,
    })

    wrapper = mount(CspViolations)
    await flushPromises()

    const select = wrapper.find('select')
    await select.setValue('script-src')
    await flushPromises()

    expect(mockCspApi.getCspViolations).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      directive: 'script-src',
    })
  })

  it('calls clearCspViolations on confirm', async () => {
    mockCspApi.getCspViolations.mockResolvedValue({
      violations: mockViolations,
      total: 2,
      limit: 20,
      offset: 0,
    })
    mockCspApi.clearCspViolations.mockResolvedValue({ deletedCount: 2 })

    wrapper = mount(CspViolations)
    await flushPromises()

    const clearBtn = wrapper.find('.danger')
    await clearBtn.trigger('click')
    await flushPromises()

    expect(mockCspApi.clearCspViolations).toHaveBeenCalled()
  })

  it('paginates correctly', async () => {
    mockCspApi.getCspViolations.mockResolvedValue({
      violations: mockViolations,
      total: 40,
      limit: 20,
      offset: 0,
    })

    wrapper = mount(CspViolations)
    await flushPromises()

    expect(wrapper.text()).toContain('Page 1 of 2')

    const nextBtn = wrapper.findAll('button').find(b => b.text() === 'Next')
    if (nextBtn) {
      await nextBtn.trigger('click')
      await flushPromises()

      expect(mockCspApi.getCspViolations).toHaveBeenLastCalledWith({
        limit: 20,
        offset: 20,
      })
    }
  })

  it('handles API error', async () => {
    mockCspApi.getCspViolations.mockRejectedValue(new Error('Network error'))

    wrapper = mount(CspViolations)
    await flushPromises()

    expect(wrapper.text()).toContain('Network error')
  })
})
