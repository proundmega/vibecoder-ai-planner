<script setup>
defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])
</script>

<template>
  <div class="phase-deployed">
    <h2>Deployed</h2>
    <div class="status-badge deployed">
      &#128640; Successfully Deployed
    </div>

    <p class="phase-description">
      This ticket has been deployed to the target environment.
    </p>

    <div class="deployment-info">
      <h3>Deployment Details</h3>
      <table class="info-table">
        <tbody>
          <tr>
            <td class="info-label">Environment:</td>
            <td class="info-value">staging (stub)</td>
          </tr>
          <tr>
            <td class="info-label">Timestamp:</td>
            <td class="info-value">{{ new Date().toLocaleString() }}</td>
          </tr>
          <tr>
            <td class="info-label">Triggered by:</td>
            <td class="info-value">human (stub)</td>
          </tr>
          <tr>
            <td class="info-label">Commit SHA:</td>
            <td class="info-value">N/A</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="rollback-section">
      <button
        disabled
        class="btn-rollback"
        title="Requires bp-37 — Deployment Pipeline"
      >
        &#8634; Rollback
      </button>
      <p class="rollback-note">Rollback requires bp-37 — Deployment Pipeline</p>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back to Board</button>
    </div>
  </div>
</template>

<style scoped>
.phase-deployed {
  max-width: 600px;
}

.phase-deployed h2 {
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
  background: #dbeafe;
  color: #1e40af;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.deployment-info {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 24px;
}

.deployment-info h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #374151;
}

.info-table {
  width: 100%;
  border-collapse: collapse;
}

.info-table td {
  padding: 8px 0;
  border-bottom: 1px solid #e5e7eb;
}

.info-table tr:last-child td {
  border-bottom: none;
}

.info-label {
  font-weight: 500;
  color: #6b7280;
  width: 40%;
}

.info-value {
  color: #374151;
}

.rollback-section {
  text-align: center;
  margin-bottom: 24px;
  padding: 16px;
  background: #fef3c7;
  border-radius: 8px;
  border: 1px solid #fde68a;
}

.btn-rollback {
  padding: 10px 20px;
  background: #9ca3af;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: not-allowed;
  font-size: 14px;
}

.rollback-note {
  margin: 8px 0 0;
  font-size: 13px;
  color: #92400e;
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
