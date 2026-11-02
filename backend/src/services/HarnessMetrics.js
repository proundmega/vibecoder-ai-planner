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

module.exports = {
  recordSweep,
  recordSweepFailure,
  counters: { reaped, reconciled, released, adopted, needsOperator, sweepFailures },
  lastSuccess,
};
