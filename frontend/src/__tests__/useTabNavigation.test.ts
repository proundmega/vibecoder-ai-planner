import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTabNavigation } from '@/composables/useTabNavigation'
import { ref } from 'vue'

describe('useTabNavigation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('initializes with first tab', () => {
    const { activeTab, tabs } = useTabNavigation([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ])
    expect(activeTab.value).toBe('a')
    expect(tabs.length).toBe(2)
  })

  it('returns empty activeTab when no tabs provided', () => {
    const { activeTab } = useTabNavigation([])
    expect(activeTab.value).toBe('')
  })

  it('switchTab changes active tab', () => {
    const { activeTab, switchTab } = useTabNavigation([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ])
    switchTab('b')
    expect(activeTab.value).toBe('b')
  })

  it('switchTab does nothing when same tab', () => {
    const { activeTab, switchTab } = useTabNavigation([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ])
    switchTab('a')
    expect(activeTab.value).toBe('a')
  })

  it('tabs with lazyLoad property are preserved', () => {
    const lazyFn = vi.fn()
    const loaded = ref(false)
    const { tabs } = useTabNavigation([
      { id: 'a', label: 'A', lazyLoad: lazyFn, loaded },
    ])
    expect(tabs[0]?.lazyLoad).toBe(lazyFn)
    expect(tabs[0]?.loaded).toBe(loaded)
  })
})
