/**
 * Normalize Express `trust proxy` configuration.
 *
 * - `true` / `false` are booleans.
 * - Digit-only values are hop counts (`1` means one trusted proxy hop).
 * - Anything else is passed through as an IP, subnet or named range
 *   (`loopback`, `10.0.0.0/8`, `a,b`).
 */
function parseTrustProxy(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  return text;
}

module.exports = { parseTrustProxy };
