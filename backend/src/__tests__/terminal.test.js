const { verifyTerminalToken } = require('../api/terminal');
const { getSecret } = require('../utils/jwt');

jest.mock('../utils/jwt');
jest.mock('jsonwebtoken');

const jwt = require('jsonwebtoken');

describe('api/terminal.js verifyTerminalToken (BP-58)', () => {
  const VALID_TOKEN = 'mock-token';
  const DECODED_USER = { id: 'user-1', email: 'user@test.com', role: 'super_admin' };

  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue(DECODED_USER);
    getSecret.mockReturnValue('test-secret-key-at-least-32-chars-long');
  });

  it('throws "Missing token" when token is null', () => {
    expect(() => verifyTerminalToken(null)).toThrow('Missing token');
  });

  it('throws "Missing token" when token is undefined', () => {
    expect(() => verifyTerminalToken(undefined)).toThrow('Missing token');
  });

  it('throws "Missing token" when token is empty string', () => {
    expect(() => verifyTerminalToken('')).toThrow('Missing token');
  });

  it('calls getSecret() from utils/jwt (not process.env.JWT_SECRET directly)', () => {
    verifyTerminalToken(VALID_TOKEN);
    expect(getSecret).toHaveBeenCalledTimes(1);
    expect(jwt.verify).toHaveBeenCalledWith(VALID_TOKEN, 'test-secret-key-at-least-32-chars-long');
  });

  it('delegates to jwt.verify with the token and getSecret() result', () => {
    const result = verifyTerminalToken(VALID_TOKEN);
    expect(jwt.verify).toHaveBeenCalledWith(VALID_TOKEN, 'test-secret-key-at-least-32-chars-long');
    expect(result).toEqual(DECODED_USER);
  });

  it('returns the decoded JWT payload', () => {
    const result = verifyTerminalToken(VALID_TOKEN);
    expect(result.id).toBe('user-1');
    expect(result.email).toBe('user@test.com');
    expect(result.role).toBe('super_admin');
  });
});
