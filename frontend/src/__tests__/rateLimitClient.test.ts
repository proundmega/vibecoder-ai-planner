import { describe, it, expect, vi, beforeEach } from 'vitest';

interface RateLimitError extends Error {
  status?: number;
  rateLimitInfo?: { retryAfter: number; retryAt: string };
  error?: {
    code: string;
    message: string;
    retryAfter: number;
    retryAt: string;
  };
}

describe('API client - Rate limit handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('extracts Retry-After header from 429 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (key: string) => key === 'Retry-After' ? '30' : null },
      json: async () => ({ error: { message: 'Too many requests' } }),
    });

    const { get } = await import('@/api/client');
    
    try {
      await get('/api/test');
    } catch (err: unknown) {
      const rateLimitErr = err as RateLimitError;
      expect(rateLimitErr.status).toBe(429);
      expect(rateLimitErr.rateLimitInfo).toBeDefined();
      expect(rateLimitErr.rateLimitInfo?.retryAfter).toBe(30);
    }
  });

  it('returns rate limit info in error object', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (key: string) => key === 'Retry-After' ? '60' : null },
      json: async () => ({}),
    });

    const { post } = await import('@/api/client');
    
    try {
      await post('/api/test', {});
    } catch (err: unknown) {
      const rateLimitErr = err as RateLimitError;
      expect(rateLimitErr.error?.code).toBe('RATE_LIMITED');
      expect(rateLimitErr.error?.retryAfter).toBe(60);
      expect(rateLimitErr.error?.retryAt).toBeDefined();
    }
  });

  it('stores rate limit state in localStorage', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (key: string) => key === 'Retry-After' ? '45' : null },
      json: async () => ({}),
    });

    const { del } = await import('@/api/client');
    
    try {
      await del('/api/test');
    } catch {
      expect(localStorage.getItem('rateLimitActive')).toBe('true');
      // The store should have been updated
      const { useRateLimitStore } = await import('@/stores/rateLimit');
      const store = useRateLimitStore();
      expect(store.rateLimitActive.value).toBe(true);
      expect(store.countdownSeconds.value).toBe(45);
    }
  });
});
