const MAX_BUCKETS = 10000;
const buckets = new Map();

function consume(key, max, windowMs, now) {
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
      // Bound memory even when every request uses a fresh ip/prefix key:
      // drop expired rows first, then the oldest insertion.
      for (const [candidate, state] of buckets) {
        if (now >= state.resetAt) buckets.delete(candidate);
      }
      while (buckets.size >= MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value);
      }
    }
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket;
}

/**
 * Small in-process limiter for enrollment/refresh/mint. Per-instance only;
 * distributed limits are deferred (fg-53 D6).
 *
 * Two buckets are checked: one per client IP and one per IP + token prefix.
 * The IP bucket prevents bypass by varying the token prefix; the scoped bucket
 * keeps a single prefix from exhausting the whole IP allowance.
 */
function agentEnrollmentRateLimit({ max = 20, windowMs = 60 * 1000, keyFn, scope = 'default' } = {}) {
  return (req, res, next) => {
    if (process.env.INTEGRATION_TESTS === '1') return next();

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const suffix = typeof keyFn === 'function' ? keyFn(req) : '';
    const now = Date.now();

    const ipBucket = consume(`${scope}:ip:${ip}`, max, windowMs, now);
    const scopedBucket = suffix ? consume(`${scope}:scope:${ip}:${suffix}`, max, windowMs, now) : null;
    const limited = ipBucket.count > max || (scopedBucket && scopedBucket.count > max);
    const remaining = Math.min(
      Math.max(0, max - ipBucket.count),
      scopedBucket ? Math.max(0, max - scopedBucket.count) : max
    );
    const resetAt = scopedBucket
      ? Math.min(ipBucket.resetAt, scopedBucket.resetAt)
      : ipBucket.resetAt;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));

    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
    });

    if (limited) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please try again later.',
          retryAfter,
        },
      });
    }

    next();
  };
}

agentEnrollmentRateLimit._reset = () => buckets.clear();
agentEnrollmentRateLimit._size = () => buckets.size;
agentEnrollmentRateLimit.MAX_BUCKETS = MAX_BUCKETS;

module.exports = agentEnrollmentRateLimit;
