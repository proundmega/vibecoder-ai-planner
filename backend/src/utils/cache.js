const MAX_CACHE_SIZE = parseInt(process.env.CACHE_MAX_SIZE) || 1000;
const DEFAULT_TTL_MS = parseInt(process.env.CACHE_DEFAULT_TTL) || 60000;

class Cache {
  constructor(maxSize = MAX_CACHE_SIZE) {
    this.store = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key, value, ttlMs = DEFAULT_TTL_MS) {
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      this.store.delete(firstKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  invalidate(pattern) {
    if (typeof pattern === 'string') {
      this.store.delete(pattern);
    } else {
      for (const key of this.store.keys()) {
        if (key.match(pattern)) {
          this.store.delete(key);
        }
      }
    }
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

const cache = new Cache();

module.exports = { cache, MAX_CACHE_SIZE, DEFAULT_TTL_MS };
