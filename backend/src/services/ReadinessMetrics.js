/**
 * fg-45 readiness metrics.
 *
 * A small in-process counter surface kept dependency-free so the readiness
 * service can increment on the hot path. Operators can read the snapshot from
 * the harness dashboard or a future Prometheus exporter (Deferred D5).
 */
const counters = new Map();

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

function snapshot() {
  return Object.fromEntries(counters.entries());
}

function reset() {
  counters.clear();
}

module.exports = { increment, snapshot, reset };
