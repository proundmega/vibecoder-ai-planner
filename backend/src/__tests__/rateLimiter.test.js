const auth = require('../middleware/auth');

describe('Rate Limiter Middleware', () => {
  let mockReq, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockReq = {
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    };
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) redisModule._resetRateLimitState();
    if (redisModule._resetStore) redisModule._resetStore();
    if (redisModule._resetSortedSets) redisModule._resetSortedSets();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should call next() on first request', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalled();
  });

  it('should call next() within rate limit', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalledTimes(2);
  });

  it('should block after exceeding rate limit', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    
    await limiter(mockReq, mockRes, nextFn);
    
    expect(nextFn).toHaveBeenCalledTimes(3);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Too many requests') })
    );
  });

  it('should set X-RateLimit-Limit header', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    expect(mockRes.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'X-RateLimit-Limit': '3' })
    );
  });

  it('should set X-RateLimit-Remaining header', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    const callArgs = mockRes.set.mock.calls[0][0];
    expect(callArgs['X-RateLimit-Remaining']).toBe('2');
  });

  it('should set X-RateLimit-Reset header', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    const callArgs = mockRes.set.mock.calls[0][0];
    expect(callArgs['X-RateLimit-Reset']).toBeDefined();
  });

  it('should set Retry-After header on 429', async () => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    
    mockRes.set.mockClear();
    await limiter(mockReq, mockRes, nextFn);
    
    expect(mockRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('should track per IP address', async () => {
    const limiter = auth.rateLimiter(2, 1000);
    const req1 = { ip: '10.0.0.1' };
    const req2 = { ip: '10.0.0.2' };
    const res = createMockRes();
    const next = jest.fn();

    await limiter(req1, res, next);
    await limiter(req2, res, next);
    await limiter(req1, res, next);
    
    expect(next).toHaveBeenCalledTimes(3);
    
    await limiter(req1, res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('should reset after time window expires', async () => {
    jest.useFakeTimers();
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    
    expect(nextFn).toHaveBeenCalledTimes(3);
    
    jest.advanceTimersByTime(1100);
    
    await limiter(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });

  it('should use different limits for different configurations', async () => {
    const strictLimiter = auth.rateLimiter(2, 1000);
    const req = { ip: '192.168.1.100' };
    const res = createMockRes();
    const next = jest.fn();

    await strictLimiter(req, res, next);
    await strictLimiter(req, res, next);
    
    res.status.mockClear();
    res.json.mockClear();
    
    await strictLimiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    
    const lenientLimiter = auth.rateLimiter(5, 1000);
    const req2 = { ip: '192.168.1.200' };
    const res2 = createMockRes();
    const next2 = jest.fn();

    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    expect(next2).toHaveBeenCalledTimes(5);
  });
});

describe('Account Lockout', () => {
  let originalAuthLockoutAttempts;
  
  beforeEach(() => {
    originalAuthLockoutAttempts = process.env.AUTH_LOCKOUT_ATTEMPTS;
    process.env.AUTH_LOCKOUT_ATTEMPTS = '10';
    jest.useRealTimers();
    // Reset rate limit state and store between tests
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
  });

  afterEach(() => {
    if (originalAuthLockoutAttempts !== undefined) {
      process.env.AUTH_LOCKOUT_ATTEMPTS = originalAuthLockoutAttempts;
    } else {
      delete process.env.AUTH_LOCKOUT_ATTEMPTS;
    }
    jest.useRealTimers();
  });

  it('should not lock on first failed attempt', async () => {
    await auth.recordFailedAttempt('10.0.1.1');
    expect(await auth.checkAccountLockout('10.0.1.1')).toBe(false);
  });

  it('should not lock before reaching threshold', async () => {
    for (let i = 0; i < 9; i++) {
      await auth.recordFailedAttempt('10.0.1.2');
    }
    expect(await auth.checkAccountLockout('10.0.1.2')).toBe(false);
  });

  it('should lock after reaching threshold', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.3');
    }
    expect(await auth.checkAccountLockout('10.0.1.3')).toBe(true);
  });

  it('should track per IP', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.4');
    }
    expect(await auth.checkAccountLockout('10.0.1.4')).toBe(true);
    expect(await auth.checkAccountLockout('10.0.1.5')).toBe(false);
  });

  it('should unlock after lockout window', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.6');
    }
    expect(await auth.checkAccountLockout('10.0.1.6')).toBe(true);
    
    jest.useFakeTimers();
    jest.advanceTimersByTime(16 * 60 * 1000);
    
    expect(await auth.checkAccountLockout('10.0.1.6')).toBe(false);
    jest.useRealTimers();
  });

  it('should clear on successful login', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.7');
    }
    expect(await auth.checkAccountLockout('10.0.1.7')).toBe(true);
    
    auth.clearFailedAttempts('10.0.1.7');
    expect(await auth.checkAccountLockout('10.0.1.7')).toBe(false);
  });

  it('should return lockout remaining time', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.8');
    }
    const remaining = await auth.getLockoutRemainingMs('10.0.1.8');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('should return 0 remaining time when not locked', async () => {
    expect(await auth.getLockoutRemainingMs('10.0.1.99')).toBe(0);
  });

  it('should not increment count when already locked', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.10');
    }
    const remaining1 = await auth.getLockoutRemainingMs('10.0.1.10');
    
    for (let i = 0; i < 5; i++) {
      await auth.recordFailedAttempt('10.0.1.10');
    }
    const remaining2 = await auth.getLockoutRemainingMs('10.0.1.10');
    
    expect(remaining2).toBeLessThanOrEqual(remaining1);
  });
});

describe('Rate Limiter — high-volume regression', () => {
  beforeEach(() => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
  });

  it('should return 429 after 31 requests within 60 seconds', async () => {
    // Reset state at the start of this test
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(30, 60000);
    const req = { ip: '10.0.2.1', connection: { remoteAddress: '10.0.2.1' } };
    const next = jest.fn();

    // Send 31 requests; first 30 should pass, 31st should be blocked
    for (let i = 0; i < 31; i++) {
      await limiter(req, mockRes, next);
    }

    expect(next).toHaveBeenCalledTimes(30);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Too many requests') })
    );
  });

  it('should set Retry-After header on 429 response', async () => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(30, 60000);
    const req = { ip: '10.0.2.2', connection: { remoteAddress: '10.0.2.2' } };
    const next = jest.fn();

    for (let i = 0; i < 31; i++) {
      await limiter(req, mockRes, next);
    }

    expect(mockRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });
});

function createMockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    set: jest.fn().mockReturnThis(),
  };
}
