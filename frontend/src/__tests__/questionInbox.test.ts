import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  listInboxQuestions: vi.fn(),
  answerQuestion: vi.fn(),
}))

vi.mock('@/api/questions', () => api)

import QuestionInbox from '@/views/QuestionInbox.vue'

function pendingQuestion(overrides = {}) {
  return {
    id: '7',
    run_id: '11111111-1111-4111-8111-111111111111',
    ticket_id: '42',
    project_id: '5',
    runtime_id: '3',
    kind: 'question',
    status: 'pending',
    prompt: 'Which helper should I use?',
    project_name: 'Demo',
    ticket_title: 'Add filtering',
    ...overrides,
  }
}

describe('QuestionInbox (fg-55)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listInboxQuestions.mockResolvedValue([pendingQuestion()])
    api.answerQuestion.mockResolvedValue({ id: '7', status: 'answered' })
  })

  it('lists pending questions', async () => {
    const wrapper = mount(QuestionInbox)
    await flushPromises()

    expect(api.listInboxQuestions).toHaveBeenCalledWith({ status: 'pending', limit: 50 })
    expect(wrapper.text()).toContain('Which helper should I use?')
    expect(wrapper.text()).toContain('Add filtering')
  })

  it('submits an answer and reloads the inbox', async () => {
    const wrapper = mount(QuestionInbox)
    await flushPromises()

    await wrapper.find('textarea').setValue('Use the existing helper.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.answerQuestion).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '7',
      'Use the existing helper.',
    )
    expect(api.listInboxQuestions).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state', async () => {
    api.listInboxQuestions.mockResolvedValue([])
    const wrapper = mount(QuestionInbox)
    await flushPromises()

    expect(wrapper.find('[data-testid="inbox-empty"]').exists()).toBe(true)
  })

  it('shows an error state when the API fails', async () => {
    api.listInboxQuestions.mockRejectedValue(new Error('network down'))
    const wrapper = mount(QuestionInbox)
    await flushPromises()

    expect(wrapper.find('[data-testid="inbox-error"]').text()).toContain('network down')
  })

  it('shows the answer for a completed question', async () => {
    api.listInboxQuestions.mockResolvedValue([
      pendingQuestion({ status: 'answered', answer: 'Use the helper.' }),
    ])
    const wrapper = mount(QuestionInbox)
    await flushPromises()

    expect(wrapper.text()).toContain('answered:')
    expect(wrapper.text()).toContain('Use the helper.')
    expect(wrapper.find('form').exists()).toBe(false)
  })
})
