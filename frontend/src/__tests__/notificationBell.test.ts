import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}))

vi.mock('@/api/notifications', () => api)

import NotificationBell from '@/components/NotificationBell.vue'
import { useAuthStore } from '@/stores/auth'

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : \'/questions\'"><slot /></a>',
}

function mountBell() {
  return mount(NotificationBell, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('NotificationBell (fg-55)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore().setToken('test-token')
    api.getUnreadCount.mockResolvedValue(3)
    api.listNotifications.mockResolvedValue([
      {
        id: '1',
        user_id: '9',
        type: 'question',
        payload: { preview: 'Which helper?' },
        read_at: null,
      },
    ])
    api.markNotificationRead.mockResolvedValue({ id: '1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call the API without a token', async () => {
    useAuthStore().setToken('')
    const wrapper = mountBell()
    await flushPromises()

    expect(api.getUnreadCount).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="notification-badge"]').exists()).toBe(false)
  })

  it('renders the unread badge from the count endpoint', async () => {
    const wrapper = mountBell()
    await flushPromises()

    expect(api.getUnreadCount).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="notification-badge"]').text()).toBe('3')
  })

  it('polls the unread count every 30 seconds', async () => {
    vi.useFakeTimers()
    mountBell()
    await flushPromises()

    expect(api.getUnreadCount).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.getUnreadCount).toHaveBeenCalledTimes(2)
  })

  it('pauses polling while the tab is hidden', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    mountBell()
    await flushPromises()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1)
    visibility.mockRestore()
  })

  it('marks a notification read when opened', async () => {
    const wrapper = mountBell()
    await flushPromises()

    await wrapper.find('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    expect(api.listNotifications).toHaveBeenCalledWith({ limit: 10 })
    expect(wrapper.text()).toContain('Which helper?')

    await wrapper.find('.bell-item-button').trigger('click')
    await flushPromises()
    expect(api.markNotificationRead).toHaveBeenCalledWith('1')
  })

  it('shows an error without breaking the bell', async () => {
    api.getUnreadCount.mockRejectedValue(new Error('offline'))
    const wrapper = mountBell()
    await flushPromises()

    await wrapper.find('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="notification-dropdown"]').text()).toContain('offline')
  })
})
