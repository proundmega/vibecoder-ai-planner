const client = require('prom-client');

const register = new client.Registry();
const createdMetrics = new Map();

function createGauge(name, help) {
  const key = `gauge:${name}`;
  if (createdMetrics.has(key)) return createdMetrics.get(key);
  const metric = new client.Gauge({ name, help });
  register.registerMetric(metric);
  createdMetrics.set(key, metric);
  return metric;
}

function createHistogram(name, help, labelNames, buckets) {
  const key = `histogram:${name}:${labelNames.join(',')}`;
  if (createdMetrics.has(key)) return createdMetrics.get(key);
  const metric = new client.Histogram({ name, help, labelNames, buckets });
  register.registerMetric(metric);
  createdMetrics.set(key, metric);
  return metric;
}

function createCounter(name, help, labelNames) {
  const key = `counter:${name}:${labelNames.join(',')}`;
  if (createdMetrics.has(key)) return createdMetrics.get(key);
  const metric = new client.Counter({ name, help, labelNames });
  register.registerMetric(metric);
  createdMetrics.set(key, metric);
  return metric;
}

module.exports = { register, createGauge, createHistogram, createCounter };
