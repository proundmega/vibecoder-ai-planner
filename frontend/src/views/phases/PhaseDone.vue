<script setup>
defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])
</script>

<template>
  <div class="phase-done">
    <h2>Done</h2>
    <div class="status-badge done">
      &#10003; Ticket Complete
    </div>

    <p class="phase-description">
      This ticket has been completed. Ready for deployment.
    </p>

    <div class="summary-section">
      <h3>Ticket Summary</h3>
      <div class="summary-content">
        <div class="summary-row">
          <span class="summary-label">Status:</span>
          <span class="summary-value">
            <span class="badge done-badge">done</span>
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Completed:</span>
          <span class="summary-value">{{ new Date().toLocaleString() }}</span>
        </div>
      </div>
    </div>

    <div class="deploy-section">
      <button
        disabled
        class="btn-deploy"
        title="Requires bp-37 — Deployment Pipeline"
      >
        &#128640; Deploy to Staging
      </button>
      <p class="deploy-note">Deployment requires bp-37 — Deployment Pipeline</p>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back to Board</button>
    </div>
  </div>
</template>

<style scoped>
.phase-done {
  max-width: 600px;
}

.phase-done h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.status-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 16px;
  background: #d1fae5;
  color: #065f46;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.summary-section {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 24px;
}

.summary-section h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #374151;
}

.summary-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.summary-label {
  font-weight: 500;
  color: #6b7280;
}

.summary-value {
  color: #374151;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.done-badge {
  background: #d1fae5;
  color: #065f46;
}

.deploy-section {
  text-align: center;
  margin-bottom: 24px;
  padding: 24px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.btn-deploy {
  padding: 12px 24px;
  background: #9ca3af;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: not-allowed;
  font-size: 16px;
  font-weight: 500;
}

.deploy-note {
  margin: 8px 0 0;
  font-size: 13px;
  color: #9ca3af;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary:hover {
  background: #f9fafb;
}
</style>
