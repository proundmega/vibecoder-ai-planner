const HarnessMetrics = require('../services/HarnessMetrics');

const summary = {
  reaped: 2,
  reconciled: 1,
  released: 1,
  adopted: 1,
  needsOperator: 1,
};

describe('HarnessMetrics', () => {
  beforeEach(() => {
    Object.values(HarnessMetrics.counters).forEach((counter) => counter.reset());
    HarnessMetrics.lastSuccess.reset();
  });

  it('records counters and advances the success timestamp for a complete sweep', async () => {
    HarnessMetrics.recordSweep(summary);

    expect((await HarnessMetrics.lastSuccess.get()).values[0].value).toBeGreaterThan(0);
    expect((await HarnessMetrics.counters.reaped.get()).values[0].value).toBe(2);
    expect((await HarnessMetrics.counters.reconciled.get()).values[0].value).toBe(1);
    expect((await HarnessMetrics.counters.released.get()).values[0].value).toBe(1);
    expect((await HarnessMetrics.counters.adopted.get()).values[0].value).toBe(1);
    expect((await HarnessMetrics.counters.needsOperator.get()).values[0].value).toBe(1);
    expect((await HarnessMetrics.counters.sweepFailures.get()).values[0].value).toBe(0);
  });

  it('does not mark an incomplete sweep healthy', async () => {
    HarnessMetrics.recordSweep(summary, { complete: false });

    expect((await HarnessMetrics.lastSuccess.get()).values[0].value).toBe(0);
    expect((await HarnessMetrics.counters.sweepFailures.get()).values[0].value).toBe(1);
  });

  it('counts a sweep that threw before completing', async () => {
    HarnessMetrics.recordSweepFailure();
    expect((await HarnessMetrics.counters.sweepFailures.get()).values[0].value).toBe(1);
  });
});
