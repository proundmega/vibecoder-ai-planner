const buckets = new Map();

/**
 * Small in-process limiter for enrollment/refresh/mint. Per-instance only;
 * distributed limits are deferred (fg-53 D6). `keyFn` lets the caller mix the
 * client IP with a token prefix so probing one prefix cannot exhaust another.
 */
function agentEnrollmentRateLimit({ max = 20, windowMs = 60 * 1000, keyFn } = {}) {
  return (req, res, next) => {
    if (process.env.INTEGRATION_TESTS === '1') return next();

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const suffix = typeof keyFn === 'function' ? keyFn(req) : '';
    const key = `${ip}:${suffix}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(Math.max(0, max - bucket.count)),
      'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
    });

    if (bucket.count > max) {
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

module.exports = agentEnrollmentRateLimit;
