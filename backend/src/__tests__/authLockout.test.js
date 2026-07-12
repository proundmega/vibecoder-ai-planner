const { pool } = require('../db');
const UserService = require('../services/UserService');
const User = require('../models/user');

jest.mock('../db', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../models/user', () => {
  const MockUser = jest.fn().mockImplementation((data) => ({
    id: data.id,
    email: data.email,
    name: data.name,
    passwordHash: data.password_hash,
    role: data.role || 'project_admin',
    currentPlan: data.current_plan || 'free',
    isActive: data.is_active !== false,
    userCreatedBy: data.user_created_by || null,
    createdAt: data.created_at,
    lockedUntil: data.locked_until ? new Date(data.locked_until) : null,
    loginAttempts: data.login_attempts || 0,
  }));
  MockUser.findByEmail = jest.fn();
  MockUser.existsByEmail = jest.fn();
  return MockUser;
});

jest.mock('bcryptjs', () => ({
  compare: jest.fn()
}));

const bcrypt = require('bcryptjs');

describe('UserService - Account Lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
  });

  it('throws 423 when account is locked (locked_until in future)', async () => {
    const future = new Date(Date.now() + 900000);
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      passwordHash: 'hashed',
      isActive: true,
      lockedUntil: future,
    };
    User.findByEmail.mockResolvedValue(mockUser);

    let caughtError;
    try {
      await UserService.authenticate('test@example.com', 'wrong');
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeDefined();
    expect(caughtError.code).toBe('ACCOUNT_LOCKED');
    expect(caughtError.statusCode).toBe(423);
    expect(caughtError.lockedUntil).toBe(future);
    expect(caughtError.retryAfter).toBeGreaterThan(0);
  });

  it('allows login when lockout has expired (locked_until in past)', async () => {
    const past = new Date(Date.now() - 60000);
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      passwordHash: 'hashed',
      isActive: true,
      lockedUntil: past,
    };
    User.findByEmail.mockResolvedValue(mockUser);
    bcrypt.compare.mockResolvedValue(true);

    // Mock the reset query
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await UserService.authenticate('test@example.com', 'correct');
    expect(result).toBe(mockUser);
  });

  it('skips lockout check when locked_until is null', async () => {
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      passwordHash: 'hashed',
      isActive: true,
      lockedUntil: null,
    };
    User.findByEmail.mockResolvedValue(mockUser);
    bcrypt.compare.mockResolvedValue(true);

    // Mock the reset query
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await UserService.authenticate('test@example.com', 'correct');
    expect(result).toBe(mockUser);
  });

  it('increments login_attempts via incrementFailedAttempts', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ login_attempts: 1, locked_until: null }] });

    const result = await UserService.incrementFailedAttempts(1);

    expect(result).toEqual({ login_attempts: 1, locked_until: null });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET login_attempts'),
      [1, 10]
    );
  });

  it('sets locked_until when attempts reach threshold', async () => {
    const lockedTime = new Date(Date.now() + 900000);
    pool.query.mockResolvedValueOnce({ rows: [{ login_attempts: 10, locked_until: lockedTime }] });

    const result = await UserService.incrementFailedAttempts(1);

    expect(result.login_attempts).toBe(10);
    expect(result.locked_until).toEqual(lockedTime);
  });

  it('resets login_attempts on success via resetFailedAttempts', async () => {
    await UserService.resetFailedAttempts(1);

    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1',
      [1]
    );
  });

  it('unlockUser resets attempts and locked_until', async () => {
    const mockRow = { id: 1, email: 'test@example.com', login_attempts: 0, locked_until: null };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await UserService.unlockUser(1);

    expect(result).toEqual(mockRow);
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id, email, login_attempts, locked_until',
      [1]
    );
  });

  it('unlockUser returns null for non-existent user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await UserService.unlockUser(999);

    expect(result).toBeNull();
  });
});
