const IpWhitelistService = require('../services/IpWhitelistService');
const { pool } = require('../db');

jest.mock('../db', () => ({
  pool: { query: jest.fn() }
}));

describe('IpWhitelistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists all whitelisted IPs ordered by created_at DESC', async () => {
    const mockRows = [
      { id: 1, ip_address: '192.168.1.1', description: 'Office', created_by: 1, created_at: new Date() }
    ];
    pool.query.mockResolvedValueOnce({ rows: mockRows });

    const result = await IpWhitelistService.list();

    expect(result).toEqual(mockRows);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, ip_address, description, created_by, created_at FROM ip_whitelist ORDER BY created_at DESC'
    );
  });

  it('creates a whitelisted IP with validation', async () => {
    const mockRow = { id: 1, ip_address: '203.0.113.50', description: 'CI/CD', created_by: 1, created_at: new Date() };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await IpWhitelistService.create('203.0.113.50', 'CI/CD', 1);

    expect(result).toEqual(mockRow);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ip_whitelist'),
      ['203.0.113.50', 'CI/CD', 1]
    );
  });

  it('rejects invalid IP addresses', async () => {
    let caughtError;
    try {
      await IpWhitelistService.create('not-an-ip', 'test', 1);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeDefined();
    expect(caughtError.code).toBe('INVALID_IP');
    expect(caughtError.statusCode).toBe(400);
  });

  it('deletes a whitelisted IP', async () => {
    const mockRow = { id: 1, ip_address: '192.168.1.1' };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await IpWhitelistService.delete(1);

    expect(result).toEqual(mockRow);
    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM ip_whitelist WHERE id = $1 RETURNING id, ip_address',
      [1]
    );
  });

  it('throws 404 when deleting non-existent IP', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    let caughtError;
    try {
      await IpWhitelistService.delete(999);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeDefined();
    expect(caughtError.code).toBe('IP_NOT_FOUND');
    expect(caughtError.statusCode).toBe(404);
  });

  it('checks if IP is whitelisted', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const result = await IpWhitelistService.isWhitelisted('192.168.1.1');

    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT 1 FROM ip_whitelist WHERE ip_address = $1',
      ['192.168.1.1']
    );
  });

  it('returns false for non-whitelisted IP', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await IpWhitelistService.isWhitelisted('10.0.0.1');

    expect(result).toBe(false);
  });

  it('validates IPv4 addresses', async () => {
    expect(IpWhitelistService.validateIp('192.168.1.1')).toBe(true);
    expect(IpWhitelistService.validateIp('10.0.0.1')).toBe(true);
    expect(IpWhitelistService.validateIp('255.255.255.255')).toBe(true);
    expect(IpWhitelistService.validateIp('not-an-ip')).toBe(false);
    expect(IpWhitelistService.validateIp('999.999.999.999')).toBe(false);
  });

  it('validates IPv6 addresses', async () => {
    expect(IpWhitelistService.validateIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(IpWhitelistService.validateIp('::1')).toBe(true);
    expect(IpWhitelistService.validateIp('fe80::1')).toBe(true);
    expect(IpWhitelistService.validateIp('2001:db8::1')).toBe(true);
    expect(IpWhitelistService.validateIp('::')).toBe(true);
    expect(IpWhitelistService.validateIp('not-an-ip')).toBe(false);
  });
});
