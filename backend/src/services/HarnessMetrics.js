const { createCounter, createGauge } = require('../metrics');

const reaped = createCounter(
  'harness_runs_reaped_total',
  'Terminal harness runs produced by lease/orphan reaping',
  []
);
const reconciled = createCounter(
  'harness_runs_reconciled_total',
  'Terminal harness runs whose ticket was reconciled',
  []
);
const released = createCounter(
  'harness_runs_released_total',
  'Harness tickets returned to backlog after a failed run',
  []
);
const adopted = createCounter(
  'harness_runs_adopted_total',
  'Published harness runs adopted into a reviewed ticket',
  []
);
const needsOperator = createCounter(
  'harness_runs_needs_operator_total',
  'Terminal harness runs left for operator handling',
  []
);
const sweepFailures = createCounter(
  'harness_reaper_sweep_failures_total',
  'Harness reaper sweeps that could not complete cleanly',
  []
);
const lastSuccess = createGauge(
  'harness_reaper_last_success_timestamp_seconds',
  'Unix timestamp of the last complete harness reaper sweep'
);

// fg-41: event stream and audit health.
const eventsIngested = createCounter(
  'harness_events_ingested_total',
  'Harness events accepted for storage, by type',
  ['type']
);
const eventsRejected = createCounter(
  'harness_events_rejected_total',
  'Harness events rejected before storage, by reason',
  ['reason']
);
const eventsPurged = createCounter(
  'harness_events_purged_total',
  'Harness events removed by the retention policy',
  []
);
const eventsSecretFlagged = createCounter(
  'harness_events_secret_flagged_total',
  'Harness events whose payload contained a redacted credential pattern',
  []
);
const eventsDuplicates = createCounter(
  'harness_events_duplicate_total',
  'Harness events ignored because the event id was already stored',
  []
);
const stuckRuns = createGauge(
  'harness_runs_stuck',
  'Running harness runs whose heartbeat is older than the stuck threshold'
);

// fg-38: budgets and routing.
const budgetWarnings = createCounter(
  'harness_budget_warnings_total',
  'Harness budget soft warnings emitted',
  []
);
const budgetBreaches = createCounter(
  'harness_budget_breaches_total',
  'Harness runs stopped by a hard budget limit',
  []
);
const usageCostTotal = createCounter(
  'harness_usage_cost_usd_total',
  'Cumulative reported harness usage cost in USD',
  []
);
const usageTokens = createCounter(
  'harness_usage_tokens_total',
  'Cumulative reported harness tokens by direction',
  ['direction']
);
const killSwitch = createGauge(
  'harness_kill_switch_enabled',
  'Whether a harness kill switch is enabled (1) or not (0), by scope',
  ['scope']
);

const OBSERVED_EVENT_TYPES = new Set([
  'run.started', 'step.changed', 'prompt.sent', 'tool.called', 'file.edited',
  'verification.result', 'diff.collected', 'publish.started', 'pr.opened',
  'review.result', 'fix.requested', 'budget.warning', 'budget.breach',
  'run.failed', 'run.succeeded', 'routing.decided', 'usage.recorded',
  'privacy.decision',
  'audit.publish', 'audit.review', 'audit.merge', 'audit.rollback',
  'audit.privacy',
]);

function recordSweep(summary, { complete = true } = {}) {
  if (summary.reaped > 0) reaped.inc(summary.reaped);
  if (summary.reconciled > 0) reconciled.inc(summary.reconciled);
  if (summary.released > 0) released.inc(summary.released);
  if (summary.adopted > 0) adopted.inc(summary.adopted);
  if (summary.needsOperator > 0) needsOperator.inc(summary.needsOperator);
  if (complete) {
    lastSuccess.set(Math.floor(Date.now() / 1000));
  } else {
    sweepFailures.inc();
  }
}

function recordSweepFailure() {
  sweepFailures.inc();
}

function recordEvent(type, { secretFlagged = false, duplicate = false } = {}) {
  eventsIngested.inc({ type: OBSERVED_EVENT_TYPES.has(type) ? type : 'other' });
  if (duplicate) eventsDuplicates.inc();
  if (secretFlagged) eventsSecretFlagged.inc();
}

function recordEventRejected(reason) {
  eventsRejected.inc({ reason: reason || 'unknown' });
}

function recordEventsPurged(count) {
  if (count > 0) eventsPurged.inc(count);
}

function recordBudgetWarning() {
  budgetWarnings.inc();
}

function recordBudgetBreach() {
  budgetBreaches.inc();
}

function recordUsage({ inputTokens, outputTokens, costUsd }) {
  if (inputTokens > 0) usageTokens.inc({ direction: 'input' }, inputTokens);
  if (outputTokens > 0) usageTokens.inc({ direction: 'output' }, outputTokens);
  if (costUsd > 0) usageCostTotal.inc(costUsd);
}

function setStuckRuns(count) {
  stuckRuns.set(Math.max(0, Number(count) || 0));
}

function setKillSwitch(scope, enabled) {
  killSwitch.set({ scope }, enabled ? 1 : 0);
}

module.exports = {
  recordSweep,
  recordSweepFailure,
  recordEvent,
  recordEventRejected,
  recordEventsPurged,
  recordBudgetWarning,
  recordBudgetBreach,
  recordUsage,
  setStuckRuns,
  setKillSwitch,
  counters: {
    reaped,
    reconciled,
    released,
    adopted,
    needsOperator,
    sweepFailures,
    eventsIngested,
    eventsRejected,
    eventsPurged,
    eventsSecretFlagged,
    eventsDuplicates,
    budgetWarnings,
    budgetBreaches,
    usageCostTotal,
    usageTokens,
  },
  gauges: { stuckRuns, killSwitch },
  lastSuccess,
};
