const { createCounter, createHistogram } = require('../metrics');

/**
 * fg-53 observability. Labels are bounded enumerations only; tokens, prefixes,
 * agent names and IPs are never used as labels.
 */
const enrollmentCounter = createCounter(
  'agent_enrollment_total',
  'Agent enrollment attempts by result',
  ['result']
);

const refreshCounter = createCounter(
  'agent_refresh_total',
  'Agent refresh attempts by result',
  ['result']
);

const authFailureCounter = createCounter(
  'agent_auth_failures_total',
  'Agent credential failures by reason',
  ['reason']
);

const enrollmentDuration = createHistogram(
  'agent_enrollment_duration_ms',
  'Agent enrollment duration in milliseconds',
  [],
  [10, 25, 50, 100, 250, 500, 1000]
);

const refreshDuration = createHistogram(
  'agent_refresh_duration_ms',
  'Agent refresh duration in milliseconds',
  [],
  [5, 10, 25, 50, 100, 250, 500]
);

module.exports = {
  enrollmentCounter,
  refreshCounter,
  authFailureCounter,
  enrollmentDuration,
  refreshDuration,
};
