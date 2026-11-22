<script setup lang="ts">
import type { ReadinessIssue } from '@/api/tickets'

withDefaults(defineProps<{
  issues?: ReadinessIssue[]
  waivedCodes?: string[]
  compact?: boolean
}>(), {
  issues: () => [],
  waivedCodes: () => [],
  compact: false,
})
</script>

<template>
  <div class="readiness-issues" :class="{ compact }">
    <ul v-if="issues.length > 0" class="issue-list">
      <li v-for="issue in issues" :key="`${issue.code}-${issue.file || ''}-${issue.section || ''}`" class="issue">
        <span class="issue-code">{{ issue.code }}</span>
        <span class="issue-message">{{ issue.message }}</span>
        <span v-if="issue.file" class="issue-location">{{ issue.file }}<template v-if="issue.section"> › {{ issue.section }}</template></span>
      </li>
    </ul>
    <p v-else class="issue-empty">All readiness checks pass.</p>
    <p v-if="waivedCodes.length > 0" class="waived-note">
      Waived until the override expires: {{ waivedCodes.join(', ') }}
    </p>
  </div>
</template>

<style scoped>
.readiness-issues { font-size: 13px; }
.issue-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.issue { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 8px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; }
.issue-code { font-family: monospace; font-weight: 600; color: #92400e; }
.issue-message { color: #4b5563; flex: 1 1 240px; }
.issue-location { color: #6b7280; font-size: 12px; }
.issue-empty { margin: 0; color: #047857; }
.waived-note { margin: 8px 0 0; color: #92400e; font-size: 12px; }
.compact .issue { padding: 4px 6px; }
</style>
