const ReadinessMetrics = require('../services/ReadinessMetrics');

describe('ReadinessMetrics', () => {
  beforeEach(() => ReadinessMetrics.reset());

  test('counters and observations are grouped by labels', () => {
    ReadinessMetrics.increment('tickets_ready_total');
    ReadinessMetrics.increment('tickets_ready_total');
    ReadinessMetrics.increment('tickets_blocked_by_readiness_total', { source: 'pickup' });
    ReadinessMetrics.observe('readiness_time_to_ready_seconds', 60);
    ReadinessMetrics.observe('readiness_time_to_ready_seconds', 120);

    const snapshot = ReadinessMetrics.snapshot();

    expect(snapshot.counters.tickets_ready_total).toBe(2);
    expect(snapshot.counters['tickets_blocked_by_readiness_total{source=pickup}']).toBe(1);
    expect(snapshot.observations['readiness_time_to_ready_seconds']).toMatchObject({
      count: 2,
      sum: 180,
      min: 60,
      max: 120,
      average: 90,
    });
  });
});
