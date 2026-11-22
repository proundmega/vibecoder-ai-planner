import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  listTicketQuestions: vi.fn(),
  answerQuestion: vi.fn(),
}))

vi.mock('@/api/questions', () => api)

import TicketQuestionCard from '@/components/TicketQuestionCard.vue'

function question(overrides = {}) {
  return {
    id: '7',
    run_id: '11111111-1111-4111-8111-111111111111',
    ticket_id: '42',
    project_id: '5',
    runtime_id: '3',
    kind: 'permission',
    status: 'pending',
    prompt: 'Allow writing to src/lib/foo.ts?',
    ...overrides,
  }
}

describe('TicketQuestionCard (fg-55)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listTicketQuestions.mockResolvedValue([question()])
    api.answerQuestion.mockResolvedValue({ id: '7', status: 'answered' })
  })

  it('sends an explicit reject for a permission request', async () => {
    const wrapper = mount(TicketQuestionCard, { props: { ticketId: '42' } })
    await flushPromises()

    expect(wrapper.text()).toContain('Allow writing')
    expect(wrapper.find('textarea').exists()).toBe(false)
    const reject = wrapper.findAll('button').find((button) => button.text() === 'Reject')
    expect(reject).toBeTruthy()

    await reject!.trigger('click')
    await flushPromises()

    expect(api.answerQuestion).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '7',
      'reject',
    )
    expect(wrapper.emitted('answered')).toBeTruthy()
    expect(wrapper.find('[data-testid="ticket-question-card"]').exists()).toBe(false)
  })

  it('maps the permission actions to once and always', async () => {
    const wrapper = mount(TicketQuestionCard, { props: { ticketId: '42' } })
    await flushPromises()

    const allow = wrapper.findAll('button').find((button) => button.text() === 'Allow once')
    await allow!.trigger('click')
    expect(api.answerQuestion).toHaveBeenLastCalledWith(
      expect.any(String), '7', 'allow')

    api.listTicketQuestions.mockResolvedValue([question()])
    const second = mount(TicketQuestionCard, { props: { ticketId: '42' } })
    await flushPromises()
    const always = second.findAll('button').find((button) => button.text() === 'Always allow')
    await always!.trigger('click')
    expect(api.answerQuestion).toHaveBeenLastCalledWith(
      expect.any(String), '7', 'always')
  })

  it('sends continue or abort for a doom-loop question', async () => {
    api.listTicketQuestions.mockResolvedValue([question({
      kind: 'doom_loop',
      prompt: 'The harness repeated the same tool call.',
    })])
    const wrapper = mount(TicketQuestionCard, { props: { ticketId: '42' } })
    await flushPromises()

    const abort = wrapper.findAll('button').find((button) => button.text() === 'Abort run')
    await abort!.trigger('click')

    expect(api.answerQuestion).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '7',
      'abort',
    )
  })

  it('keeps the free-text answer for a normal question', async () => {
    api.listTicketQuestions.mockResolvedValue([question({ kind: 'question' })])
    const wrapper = mount(TicketQuestionCard, { props: { ticketId: '42' } })
    await flushPromises()

    await wrapper.find('textarea').setValue('Use the existing helper.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.answerQuestion).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '7',
      'Use the existing helper.',
    )
  })
})
