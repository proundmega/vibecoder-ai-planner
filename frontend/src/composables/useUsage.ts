import { ref } from 'vue'
import { getProjectUsage, type UsageResponse } from '@/api/usage'
import { getProjectBilling, type Billing } from '@/api/billing'

export function useUsage(projectId: string | number) {
  const usage = ref<UsageResponse | null>(null)
  const usageLoading = ref(false)
  const usageError = ref<string | null>(null)
  const billing = ref<Billing[]>([])
  const billingLoading = ref(false)
  const billingError = ref<string | null>(null)

  async function loadUsage() {
    usageLoading.value = true
    usageError.value = null
    try {
      const result = await getProjectUsage(String(projectId))
      usage.value = result || null
    } catch (_err) {
      usageError.value = 'Failed to load usage data'
    } finally {
      usageLoading.value = false
    }
  }

  async function loadBilling() {
    billingLoading.value = true
    billingError.value = null
    try {
      const result = await getProjectBilling(String(projectId))
      billing.value = result ? [result] : []
    } catch (_err) {
      billingError.value = 'Failed to load billing data'
    } finally {
      billingLoading.value = false
    }
  }

  return {
    usage, usageLoading, usageError, billing, billingLoading, billingError,
    loadUsage, loadBilling,
  }
}
