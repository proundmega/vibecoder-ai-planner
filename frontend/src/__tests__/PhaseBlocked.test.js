import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PhaseBlocked from '@/views/phases/PhaseBlocked.vue'
import { post } from '@/api/client'

vi.mock('@/api/client', () => ({
  post: vi.fn(),
}))

describe('PhaseBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    post.mockResolvedValue({ success: true })
  })

  it('posts feedback to /api/v1/tickets/1/messages with messageType=feedback', async () => {
    const wrapper = mount(PhaseBlocked, {
      props: {
        phaseData: { id: 1, name: 'Blocked' },
        ticketId: '1',
        projectId: 'proj-1',
      },
    })

    // Set reply text
    const textarea = wrapper.find('#reply')
    await textarea.setValue('Please proceed with the fix')
    
    // Click send
    await wrapper.find('.btn-send').trigger('click')

    expect(post).toHaveBeenCalledWith('/api/v1/tickets/1/messages', {
      messageType: 'feedback',
      content: 'Please proceed with the fix',
    })
  })

  it('does not post when reply text is empty', async () => {
    const wrapper = mount(PhaseBlocked, {
      props: {
        phaseData: { id: 1, name: 'Blocked' },
        ticketId: '1',
        projectId: 'proj-1',
      },
    })

    const textarea = wrapper.find('#reply')
    await textarea.setValue('   ')
    
    await wrapper.find('.btn-send').trigger('click')

    expect(post).not.toHaveBeenCalled()
  })
})
