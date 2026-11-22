/**
 * fg-45 readiness metrics.
 *
 * A small in-process counter/gauge surface kept dependency-free so the
 * readiness service can record on the hot path. Operators can read the snapshot
 * from the harness dashboard or a future Prometheus exporter (Deferred D5).
 */
const counters = new Map();
const observations = new Map();

function keyFor(name, labels = {}) {
  const labelPart = Object.keys(labels || {})
    .sort()
    .map(label => `${label}=${labels[label]}`)
    .join(',');
  return labelPart ? `${name}{${labelPart}}` : name;
}

function increment(name, labels = {}, value = 1) {
  const key = keyFor(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

function observe(name, value, labels = {}) {
  if (!Number.isFinite(value) || value < 0) return;
  const key = keyFor(name, labels);
  const current = observations.get(key) || { count: 0, sum: 0, min: value, max: value };
  current.count += 1;
  current.sum += value;
  current.min = Math.min(current.min, value);
  current.max = Math.max(current.max, value);
  observations.set(key, current);
}

function snapshot() {
  return {
    counters: Object.fromEntries(counters.entries()),
    observations: Object.fromEntries(
      [...observations.entries()].map(([key, value]) => [
        key,
        { ...value, average: value.count > 0 ? value.sum / value.count : 0 },
      ])
    ),
  };
}

function reset() {
  counters.clear();
  observations.clear();
}

module.exports = { increment, observe, snapshot, reset };
