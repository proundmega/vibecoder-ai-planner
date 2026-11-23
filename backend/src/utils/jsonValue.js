/**
 * Normalize a JSON/JSONB column value.
 *
 * pg returns JSONB columns as parsed arrays/objects, while some callers and
 * test doubles still provide a JSON string. Accept both so template file
 * definitions do not crash on JSON.parse(object).
 */
function parseJsonValue(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

module.exports = { parseJsonValue };
