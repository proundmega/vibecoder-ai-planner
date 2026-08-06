import { ref } from 'vue'

export interface TabConfig {
  id: string
  label: string
}

export function useTabNavigation(tabs: TabConfig[]) {
  const activeTab = ref(tabs[0]?.id ?? '')

  function switchTab(tabId: string) {
    if (activeTab.value === tabId) return
    activeTab.value = tabId
  }

  return { activeTab, tabs, switchTab }
}
