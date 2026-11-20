<script setup>
defineProps({
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])
</script>

<template>
  <div class="phase-assigned">
    <h2>Assigned Phase</h2>
    <p class="phase-description">
      Runtime assignment is managed by the worker claim API. Start a worker
      runtime with a grant for this project; it claims the next eligible ticket
      and records the runtime on the claim.
    </p>

    <div class="assignment-note" role="status">
      <p>
        This phase no longer assigns a legacy agent from the removed agent API.
        Use <strong>Fleet → node → runtimes</strong> to start a worker, then let
        the worker claim the ticket.
      </p>
    </div>

    <div class="form-actions">
      <button class="btn-secondary" @click="emit('back')">Back</button>
    </div>
  </div>
</template>

<style scoped>
.phase-assigned {
  max-width: 640px;
}

.phase-assigned h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.assignment-note {
  padding: 12px 16px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  color: #1e3a8a;
  margin-bottom: 24px;
}

.form-actions {
  display: flex;
  gap: 8px;
}
</style>
