const { cache } = require('../utils/cache');

function cacheResponse(ttlMs) {
  return (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = req.originalUrl || req.url;

    const cached = cache.get(cacheKey);
    if (cached) {
      res.set('Cache-Control', `public, max-age=${Math.floor(ttlMs / 1000)}`);
      res.set('X-Cache', 'HIT');
      return res.status(cached.status).json(cached.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (!res.headers['x-cache']) {
        res.set('Cache-Control', `public, max-age=${Math.floor(ttlMs / 1000)}`);
        res.set('X-Cache', 'MISS');
      }
      cache.set(cacheKey, {
        status: res.statusCode,
        body,
      }, ttlMs);
      return originalJson(body);
    };

    next();
  };
}

function invalidateCache(pattern) {
  cache.invalidate(pattern);
}

module.exports = { cacheResponse, invalidateCache };
