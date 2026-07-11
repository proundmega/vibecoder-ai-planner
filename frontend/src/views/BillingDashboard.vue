<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getUserBilling } from '@/api/billing'

const authStore = useAuthStore()
const router = useRouter()
const billingLoading = ref(true)
const billingError = ref(null)
const billingData = ref([])

const totalCost = computed(() => {
  return billingData.value.reduce((sum, b) => sum + (parseFloat(b.total_cost_usd) || 0), 0).toFixed(4)
})

const totalCalls = computed(() => {
  return billingData.value.reduce((sum, b) => sum + (parseInt(b.total_calls) || 0), 0).toLocaleString()
})

const totalTokensIn = computed(() => {
  return billingData.value.reduce((sum, b) => sum + (parseInt(b.total_tokens_in) || 0), 0).toLocaleString()
})

const totalTokensOut = computed(() => {
  return billingData.value.reduce((sum, b) => sum + (parseInt(b.total_tokens_out) || 0), 0).toLocaleString()
})

const billingPeriods = computed(() => {
  return new Set(billingData.value.map(b => b.billing_month)).size
})

const projects = computed(() => {
  return new Set(billingData.value.map(b => b.project_id)).size
})

onMounted(async () => {
  if (authStore.user.value?.role !== 'project_admin') {
    router.push('/dashboard')
    return
  }

  billingLoading.value = true
  try {
    const response = await getUserBilling()
    billingData.value = response?.data || []
  } catch (err) {
    console.error('Failed to load billing data:', err)
    billingError.value = 'Failed to load billing data'
  } finally {
    billingLoading.value = false
  }
})
</script>

<template>
  <div class="billing-dashboard">
    <div v-if="billingLoading" class="loading">Loading billing data...</div>
    <div v-else-if="billingError" class="error">
      <p>{{ billingError }}</p>
    </div>
    <div v-else>
      <h1>Billing Dashboard</h1>
      <p class="subtitle">Your billing information across all projects</p>

      <div v-if="billingData.length === 0" class="empty-state">
        <p>No billing data available for the current period</p>
      </div>

      <template v-else>
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-label">Total Cost</div>
            <div class="summary-value">
              ${{ totalCost }}
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Total Calls</div>
            <div class="summary-value">
              {{ totalCalls }}
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Billing Periods</div>
            <div class="summary-value">
              {{ billingPeriods }}
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Projects</div>
            <div class="summary-value">
              {{ projects }}
            </div>
          </div>
        </div>

        <div class="section">
          <h2>Billing History</h2>
          <div class="table-container">
            <table class="billing-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Month</th>
                  <th>Calls</th>
                  <th>Tokens In</th>
                  <th>Tokens Out</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in billingData" :key="`${row.project_id}-${row.billing_month}`">
                  <td>{{ row.project_name }}</td>
                  <td>{{ row.billing_month }}</td>
                  <td>{{ parseInt(row.total_calls || 0).toLocaleString() }}</td>
                  <td>{{ parseInt(row.total_tokens_in || 0).toLocaleString() }}</td>
                  <td>{{ parseInt(row.total_tokens_out || 0).toLocaleString() }}</td>
                  <td>${{ (parseFloat(row.total_cost) || 0).toFixed(4) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td colspan="2"><strong>Total</strong></td>
                  <td><strong>{{ totalCalls }}</strong></td>
                  <td><strong>{{ totalTokensIn }}</strong></td>
                  <td><strong>{{ totalTokensOut }}</strong></td>
                  <td><strong>${{ totalCost }}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.billing-dashboard {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.billing-dashboard h1 {
  margin: 0 0 8px 0;
  font-size: 28px;
  color: #1f2937;
}

.subtitle {
  margin: 0 0 24px 0;
  color: #6b7280;
  font-size: 16px;
}

.loading, .error {
  padding: 60px 20px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.empty-state p {
  color: #6b7280;
  margin: 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.summary-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
}

.summary-label {
  font-size: 13px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.summary-value {
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
}

.section {
  margin-top: 32px;
}

.section h2 {
  font-size: 20px;
  color: #1f2937;
  margin: 0 0 16px 0;
}

.table-container {
  overflow-x: auto;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.billing-table {
  width: 100%;
  border-collapse: collapse;
}

.billing-table th,
.billing-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

.billing-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.billing-table td {
  color: #1f2937;
  font-size: 14px;
}

.billing-table tr:last-child td {
  border-bottom: none;
}

.total-row td {
  background: #f9fafb;
  font-weight: 700;
  border-top: 2px solid #e5e7eb;
}
</style>
