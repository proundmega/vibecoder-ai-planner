const {
  enrollmentCounter,
  refreshCounter,
  authFailureCounter,
  enrollmentDuration,
  refreshDuration,
} = require('../services/AgentEnrollmentMetrics');

describe('Agent enrollment metrics (NFR6)', () => {
  it('exposes bounded enrollment/refresh/auth counters', async () => {
    enrollmentCounter.inc({ result: 'success' });
    enrollmentCounter.inc({ result: 'failure' });
    refreshCounter.inc({ result: 'rotated' });
    refreshCounter.inc({ result: 'replay_cache_hit' });
    refreshCounter.inc({ result: 'reuse' });
    refreshCounter.inc({ result: 'invalid' });
    refreshCounter.inc({ result: 'error' });
    authFailureCounter.inc({ reason: 'expired' });

    const enrollment = await enrollmentCounter.get();
    const refresh = await refreshCounter.get();
    const auth = await authFailureCounter.get();

    expect(enrollment.values.some(v => v.labels.result === 'success' && v.value >= 1)).toBe(true);
    expect(enrollment.values.some(v => v.labels.result === 'failure' && v.value >= 1)).toBe(true);
    for (const result of ['rotated', 'replay_cache_hit', 'reuse', 'invalid', 'error']) {
      expect(refresh.values.some(v => v.labels.result === result && v.value >= 1)).toBe(true);
    }
    expect(auth.values.some(v => v.labels.reason === 'expired' && v.value >= 1)).toBe(true);
  });

  it('records enrollment and refresh durations', async () => {
    const endEnroll = enrollmentDuration.startTimer();
    endEnroll();
    const endRefresh = refreshDuration.startTimer();
    endRefresh();

    const enroll = await enrollmentDuration.get();
    const refresh = await refreshDuration.get();
    expect(enroll.values.length).toBeGreaterThan(0);
    expect(refresh.values.length).toBeGreaterThan(0);
  });
});
