const {
  reaperIntervalMs,
  DEFAULT_REAPER_INTERVAL_SECONDS,
  MIN_REAPER_INTERVAL_SECONDS,
} = require('../utils/harnessReaper');

describe('harness reaper interval', () => {
  it('defaults to 60 seconds', () => {
    expect(reaperIntervalMs()).toBe(DEFAULT_REAPER_INTERVAL_SECONDS * 1000);
    expect(reaperIntervalMs(undefined)).toBe(60_000);
    expect(reaperIntervalMs('')).toBe(60_000);
  });

  it('disables the reaper for zero or negative intervals', () => {
    expect(reaperIntervalMs(0)).toBeNull();
    expect(reaperIntervalMs('0')).toBeNull();
    expect(reaperIntervalMs(-1)).toBeNull();
  });

  it('clamps tiny intervals so a sweep cannot spin', () => {
    expect(reaperIntervalMs(1)).toBe(MIN_REAPER_INTERVAL_SECONDS * 1000);
    expect(reaperIntervalMs(5)).toBe(5_000);
  });

  it('falls back to the default for invalid values', () => {
    expect(reaperIntervalMs('not-a-number')).toBe(60_000);
    expect(reaperIntervalMs(Infinity)).toBe(60_000);
    expect(reaperIntervalMs(null)).toBe(60_000);
  });

  it('uses a configured interval unchanged', () => {
    expect(reaperIntervalMs(30)).toBe(30_000);
    expect(reaperIntervalMs('120')).toBe(120_000);
  });
});
