const { cache, MAX_CACHE_SIZE, DEFAULT_TTL_MS } = require('../utils/cache');
const { cacheResponse, invalidateCache } = require('../middleware/cache');

describe('BP-11: API Response Caching', () => {
  beforeEach(() => {
    cache.clear();
  });

  describe('Cache utility', () => {
    it('should return null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should set and get values', () => {
      cache.set('key1', { data: 'test' });
      expect(cache.get('key1')).toEqual({ data: 'test' });
    });

    it('should expire values after TTL', (done) => {
      cache.set('key1', { data: 'test' }, 50);
      setTimeout(() => {
        expect(cache.get('key1')).toBeNull();
        done();
      }, 100);
    });

    it('should invalidate by key', () => {
      cache.set('key1', { data: 'test' });
      invalidateCache('key1');
      expect(cache.get('key1')).toBeNull();
    });

    it('should invalidate by pattern', () => {
      cache.set('ticket:1', { data: 'test1' });
      cache.set('ticket:2', { data: 'test2' });
      invalidateCache(/^ticket:/);
      expect(cache.get('ticket:1')).toBeNull();
      expect(cache.get('ticket:2')).toBeNull();
    });

    it('should clear all cache', () => {
      cache.set('key1', { data: 'test1' });
      cache.set('key2', { data: 'test2' });
      cache.clear();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should evict oldest entry when full', () => {
      for (let i = 0; i < MAX_CACHE_SIZE + 10; i++) {
        cache.set(`key${i}`, { data: `value${i}` });
      }
      expect(cache.size).toBeLessThanOrEqual(MAX_CACHE_SIZE);
    });

    it('should track cache size', () => {
      expect(cache.size).toBe(0);
      cache.set('key1', { data: 'test' });
      expect(cache.size).toBe(1);
      cache.set('key2', { data: 'test' });
      expect(cache.size).toBe(2);
    });
  });

  describe('cacheResponse middleware', () => {
    it('should cache GET responses and serve from cache', () => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/tickets',
        url: '/api/tickets',
      };
      const mockRes = {
        statusCode: 200,
        headers: {},
        json: jest.fn((_body) => mockRes),
        set: jest.fn(function(key, value) {
          this.headers[key] = value;
          return this;
        }),
        status: jest.fn(function(code) {
          this.statusCode = code;
          return this;
        }),
      };
      const next = jest.fn();

      const middleware = cacheResponse(60000);

      middleware(mockReq, mockRes, next);
      mockRes.json({ success: true, data: [] });

      expect(mockRes.headers['X-Cache']).toBe('MISS');
      expect(cache.size).toBe(1);
      expect(cache.get('/api/tickets')).toEqual({
        status: 200,
        body: { success: true, data: [] },
      });
    });

    it('should set Cache-Control header', (done) => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/tickets',
        url: '/api/tickets',
      };
      const mockRes = {
        statusCode: 200,
        headers: {},
        json: jest.fn((_body) => mockRes),
        set: jest.fn(function(key, value) {
          this.headers[key] = value;
          return this;
        }),
        status: jest.fn(function(code) {
          this.statusCode = code;
          return this;
        }),
      };
      const next = jest.fn();

      const middleware = cacheResponse(60000);

      middleware(mockReq, mockRes, next);
      mockRes.json({ success: true, data: [] });

      expect(mockRes.headers['Cache-Control']).toBe('public, max-age=60');
      expect(mockRes.headers['X-Cache']).toBe('MISS');

      done();
    });

    it('should not cache non-GET requests', () => {
      const mockReq = {
        method: 'POST',
        originalUrl: '/api/tickets',
        url: '/api/tickets',
      };
      const mockRes = {
        statusCode: 200,
        headers: {},
        json: jest.fn((_body) => mockRes),
        set: jest.fn(function(key, value) {
          this.headers[key] = value;
          return this;
        }),
        status: jest.fn(function(code) {
          this.statusCode = code;
          return this;
        }),
      };
      const next = jest.fn();

      const middleware = cacheResponse(60000);
      middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('exports', () => {
    it('should export cache instance', () => {
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
    });

    it('should export MAX_CACHE_SIZE', () => {
      expect(typeof MAX_CACHE_SIZE).toBe('number');
    });

    it('should export DEFAULT_TTL_MS', () => {
      expect(typeof DEFAULT_TTL_MS).toBe('number');
    });

    it('should export cacheResponse function', () => {
      expect(typeof cacheResponse).toBe('function');
    });

    it('should export invalidateCache function', () => {
      expect(typeof invalidateCache).toBe('function');
    });
  });
});
