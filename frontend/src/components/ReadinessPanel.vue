<script setup lang="ts">
import { ref } from 'vue'
import ReadinessIssues from '@/components/ReadinessIssues.vue'
import {
  approvePlan,
  recordSmallFix,
  replan,
  grantOverride,
  revokeOverride,
  type ReadinessResult,
} from '@/api/tickets'

const props = withDefaults(defineProps<{
  ticketId: string
  readiness: ReadinessResult | null
  canApprove?: boolean
  canOverride?: boolean
}>(), {
  canApprove: false,
  canOverride: false,
})

const emit = defineEmits<{ (event: 'refresh'): void }>()

const busy = ref(false)
const actionError = ref<string | null>(null)
const showSmallFix = ref(false)
const showOverride = ref(false)
const smallFixReason = ref('')
const overrideReason = ref('')
const overrideCodes = ref('')
const overrideExpires = ref('')

function errorMessage(error: unknown): string {
  const details = (error as { details?: { issues?: Array<{ code?: string }> } } | null)?.details
  const codes = details?.issues?.map(issue => issue.code).filter(Boolean)
  if (codes && codes.length > 0) return `Readiness failed: ${codes.join(', ')}`
  return (error as Error)?.message || 'Readiness action failed'
}

async function run(action: () => Promise<unknown>) {
  busy.value = true
  actionError.value = null
  try {
    await action()
    emit('refresh')
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}

function handleApprove() {
  return run(() => approvePlan(props.ticketId))
}

function handleReplan() {
  return run(() => replan(props.ticketId))
}

function handleRevoke() {
  return run(() => revokeOverride(props.ticketId))
}

function submitSmallFix() {
  if (smallFixReason.value.trim().length < 10) {
    actionError.value = 'A small-fix reason of at least 10 characters is required'
    return
  }
  return run(async () => {
    await recordSmallFix(props.ticketId, smallFixReason.value.trim())
    showSmallFix.value = false
    smallFixReason.value = ''
  })
}

function submitOverride() {
  const codes = overrideCodes.value.split(',').map(code => code.trim()).filter(Boolean)
  if (codes.length === 0 || overrideReason.value.trim().length < 10 || !overrideExpires.value) {
    actionError.value = 'Codes, a reason of at least 10 characters and an expiry are required'
    return
  }
  return run(async () => {
    await grantOverride(props.ticketId, {
      codes,
      reason: overrideReason.value.trim(),
      expiresAt: new Date(overrideExpires.value).toISOString(),
    })
    showOverride.value = false
    overrideReason.value = ''
    overrideCodes.value = ''
    overrideExpires.value = ''
  })
}
</script>

<template>
  <section class="readiness-panel" data-testid="readiness-panel">
    <header class="panel-header">
      <h3>Definition of Ready</h3>
      <span v-if="readiness" class="readiness-badge" :class="readiness.ready ? 'ready' : 'not-ready'">
        {{ readiness.ready ? 'Ready' : 'Not ready' }}
      </span>
    </header>

    <p v-if="readiness?.template" class="template-line">
      Template: <strong>{{ readiness.template }}</strong>
      <span v-if="readiness.sectionsEnforced === false" class="sections-note">(custom template: section checks not enforced)</span>
    </p>
    <p v-if="readiness?.planApproved" class="approval-line">Plan approved. Replan to edit the approved content.</p>

    <ReadinessIssues :issues="readiness?.issues || []" :waived-codes="readiness?.waivedCodes || []" />

    <p v-if="actionError" class="action-error">{{ actionError }}</p>

    <div class="panel-actions">
      <button v-if="canApprove && !readiness?.planApproved" :disabled="busy" @click="handleApprove">Approve plan</button>
      <button v-if="canOverride && !readiness?.smallFixReason" :disabled="busy" @click="showSmallFix = !showSmallFix">Small fix</button>
      <button v-if="canOverride" :disabled="busy" @click="showOverride = !showOverride">Override…</button>
      <button v-if="canOverride && (readiness?.waivedCodes?.length || 0) > 0" :disabled="busy" @click="handleRevoke">Revoke override</button>
      <button v-if="canApprove && readiness?.planApproved" :disabled="busy" @click="handleReplan">Replan</button>
    </div>

    <form v-if="showSmallFix" class="panel-form" @submit.prevent="submitSmallFix">
      <label>Small-fix reason</label>
      <textarea v-model="smallFixReason" rows="2" placeholder="Why this is a bounded, single-layer change"></textarea>
      <div class="form-actions">
        <button type="submit" :disabled="busy">Record exemption</button>
        <button type="button" class="secondary" @click="showSmallFix = false">Cancel</button>
      </div>
    </form>

    <form v-if="showOverride" class="panel-form" @submit.prevent="submitOverride">
      <label>Issue codes (comma separated)</label>
      <input v-model="overrideCodes" type="text" placeholder="MISSING_ROLLBACK, MISSING_TEST_PLAN" />
      <label>Reason</label>
      <textarea v-model="overrideReason" rows="2" placeholder="Why the waiver is safe and time-boxed"></textarea>
      <label>Expires</label>
      <input v-model="overrideExpires" type="datetime-local" />
      <div class="form-actions">
        <button type="submit" :disabled="busy">Grant override</button>
        <button type="button" class="secondary" @click="showOverride = false">Cancel</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.readiness-panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; background: #fff; }
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-header h3 { margin: 0; font-size: 15px; }
.readiness-badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.readiness-badge.ready { background: #d1fae5; color: #065f46; }
.readiness-badge.not-ready { background: #fee2e2; color: #991b1b; }
.template-line, .approval-line { margin: 8px 0 6px; color: #4b5563; font-size: 13px; }
.sections-note { color: #6b7280; font-style: italic; margin-left: 6px; }
.panel-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.panel-actions button { padding: 5px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; }
.panel-form { margin-top: 10px; display: grid; gap: 6px; }
.panel-form label { font-size: 12px; color: #374151; }
.panel-form input, .panel-form textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px; }
.form-actions { display: flex; gap: 8px; }
.secondary { background: #fff; }
.action-error { color: #991b1b; font-size: 13px; margin: 8px 0 0; }
</style>
