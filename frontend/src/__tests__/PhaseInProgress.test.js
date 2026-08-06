import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PhaseInProgress from '@/views/phases/PhaseInProgress.vue'
import { post } from '@/api/client'

vi.mock('@/api/client', () => ({
  post: vi.fn(),
}))

describe('PhaseInProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    post.mockResolvedValue({ success: true })
  })

  it('posts feedback to /api/v1/tickets/1/messages with messageType=feedback', async () => {
    const wrapper = mount(PhaseInProgress, {
      props: {
        phaseData: { id: 1, name: 'In Progress' },
        ticketId: '1',
        projectId: 'proj-1',
      },
    })

    // Switch to feedback tab by clicking the second button
    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')
    await wrapper.vm.$nextTick()

    // Set feedback text
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Great progress, please add error handling')
    
    // Click send
    await wrapper.find('.btn-send').trigger('click')

    expect(post).toHaveBeenCalledWith('/api/v1/tickets/1/messages', {
      messageType: 'feedback',
      content: 'Great progress, please add error handling',
    })
  })

  it('does not post when feedback text is empty', async () => {
    const wrapper = mount(PhaseInProgress, {
      props: {
        phaseData: { id: 1, name: 'In Progress' },
        ticketId: '1',
        projectId: 'proj-1',
      },
    })

    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')
    await wrapper.vm.$nextTick()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('   ')
    
    await wrapper.find('.btn-send').trigger('click')

    expect(post).not.toHaveBeenCalled()
  })
})
