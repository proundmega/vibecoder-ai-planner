import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/tickets')>()
  return {
    ...actual,
    approvePlan: vi.fn().mockResolvedValue({}),
    recordSmallFix: vi.fn().mockResolvedValue({}),
    replan: vi.fn().mockResolvedValue({}),
    grantOverride: vi.fn().mockResolvedValue({}),
    revokeOverride: vi.fn().mockResolvedValue({}),
    fetchCriteria: vi.fn().mockResolvedValue([]),
    addCriteria: vi.fn().mockResolvedValue([]),
    deleteCriterion: vi.fn().mockResolvedValue(undefined),
  }
})

import ReadinessIssues from '@/components/ReadinessIssues.vue'
import ReadinessPanel from '@/components/ReadinessPanel.vue'
import { readinessIssueSummary, type ReadinessResult } from '@/api/tickets'

const notReady: ReadinessResult = {
  ready: false,
  issues: [
    { code: 'MISSING_TEMPLATE', message: 'Apply a template', waivable: false },
    { code: 'PLAN_NOT_APPROVED', message: 'Approve the plan', waivable: false },
  ],
  waivedCodes: [],
  template: null,
  sectionsEnforced: true,
  planApproved: false,
}

describe('readiness UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats readiness issue codes from a 409 payload', () => {
    expect(readinessIssueSummary({ issues: notReady.issues })).toBe(
      'MISSING_TEMPLATE, PLAN_NOT_APPROVED'
    )
    expect(readinessIssueSummary(undefined)).toBeNull()
  })

  it('renders each issue code and message', () => {
    const wrapper = mount(ReadinessIssues, { props: { issues: notReady.issues } })

    expect(wrapper.text()).toContain('MISSING_TEMPLATE')
    expect(wrapper.text()).toContain('Apply a template')
    expect(wrapper.text()).toContain('PLAN_NOT_APPROVED')
  })

  it('shows the readiness badge and approves the plan', async () => {
    const api = await import('@/api/tickets')
    const wrapper = mount(ReadinessPanel, {
      props: { ticketId: '10', readiness: notReady, canApprove: true, canOverride: false },
    })

    expect(wrapper.text()).toContain('Not ready')
    const approve = wrapper.findAll('button').find(button => button.text() === 'Approve plan')
    expect(approve).toBeDefined()
    await approve!.trigger('click')
    await flushPromises()

    expect(api.approvePlan).toHaveBeenCalledWith('10')
  })

  it('does not offer approval to a caller without the permission', () => {
    const wrapper = mount(ReadinessPanel, {
      props: { ticketId: '10', readiness: notReady, canApprove: false, canOverride: false },
    })

    expect(wrapper.text()).not.toContain('Approve plan')
  })
})
