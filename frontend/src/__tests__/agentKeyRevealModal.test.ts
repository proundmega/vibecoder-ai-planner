import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentKeyRevealModal from '@/components/AgentKeyRevealModal.vue'

const mountOptions = {
  global: {
    stubs: { Teleport: { template: '<div><slot /></div>' } },
  },
}

describe('AgentKeyRevealModal', () => {
  afterEach(() => {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard
  })

  it('shows the one-time key and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const wrapper = mount(AgentKeyRevealModal, {
      ...mountOptions,
      props: {
        agent: {
          id: 'a1',
          name: 'Worker One',
          providerName: 'OpenAI',
          apiKey: 'ak_test_secret',
          expiresAt: '2026-12-17T00:00:00.000Z',
        },
      },
    })

    expect(wrapper.find('.agent-key-value').text()).toBe('ak_test_secret')
    expect(wrapper.text()).toContain('Worker One')
    expect(wrapper.text()).toContain('OpenAI')
    expect(wrapper.text()).toContain('This is the only time this key is shown')

    const copy = wrapper.findAll('button').find(button => button.text() === 'Copy key')
    expect(copy).toBeTruthy()
    await copy!.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('ak_test_secret')
    expect(wrapper.text()).toContain('Copied')

    const done = wrapper.findAll('button').find(button => button.text() === 'Done')
    await done!.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows an unavailable message when no key was returned', () => {
    const wrapper = mount(AgentKeyRevealModal, {
      ...mountOptions,
      props: {
        agent: { id: 'a2', name: 'No Key', apiKey: null },
      },
    })

    expect(wrapper.find('.agent-key-value').exists()).toBe(false)
    expect(wrapper.text()).toContain('No key was returned')
  })
})
