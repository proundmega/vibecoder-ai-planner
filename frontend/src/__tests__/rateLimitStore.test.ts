import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRateLimitStore } from '@/stores/rateLimit';

describe('RateLimitStore', () => {
  let store: ReturnType<typeof useRateLimitStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    store = useRateLimitStore();
    store.clearRateLimit();
  });

  it('sets rate limit and starts countdown', () => {
    store.setRateLimit(60);
    
    expect(store.rateLimitActive.value).toBe(true);
    expect(store.countdownSeconds.value).toBe(60);
    expect(localStorage.getItem('rateLimitActive')).toBe('true');
  });

  it('clears rate limit state', () => {
    store.setRateLimit(60);
    store.clearRateLimit();
    
    expect(store.rateLimitActive.value).toBe(false);
    expect(store.countdownSeconds.value).toBe(0);
    expect(localStorage.getItem('rateLimitActive')).toBe(null);
  });

  it('restores rate limit state from localStorage', () => {
    const futureTime = new Date(Date.now() + 120000).toISOString();
    localStorage.setItem('rateLimitActive', 'true');
    localStorage.setItem('rateLimitRetryAt', futureTime);
    
    // Re-initialize to trigger restore
    store.restoreFromStorage();
    
    expect(store.rateLimitActive.value).toBe(true);
    expect(store.retryAt.value).toBe(futureTime);
  });
});
