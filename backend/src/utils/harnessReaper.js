const DEFAULT_REAPER_INTERVAL_SECONDS = 60;
const MIN_REAPER_INTERVAL_SECONDS = 5;

/**
 * Resolve HARNESS_REAPER_INTERVAL_SECONDS to a millisecond interval.
 * Invalid values fall back to the default; `0` or a negative value disables it.
 */
function reaperIntervalMs(raw = DEFAULT_REAPER_INTERVAL_SECONDS) {
  if (raw === null || raw === undefined || raw === '') {
    return DEFAULT_REAPER_INTERVAL_SECONDS * 1000;
  }
  const parsed = Number(raw);
  const seconds = Number.isFinite(parsed) ? parsed : DEFAULT_REAPER_INTERVAL_SECONDS;
  if (seconds <= 0) {
    return null;
  }
  return Math.max(MIN_REAPER_INTERVAL_SECONDS, seconds) * 1000;
}

module.exports = {
  reaperIntervalMs,
  DEFAULT_REAPER_INTERVAL_SECONDS,
  MIN_REAPER_INTERVAL_SECONDS,
};
