const { pool } = require('../db');
const net = require('net');

const WHITELIST_CACHE_TTL = 60000;
const whitelistCache = new Map();

class IpWhitelistService {
  static clearCache() {
    whitelistCache.clear();
  }

  static async list() {
    const result = await pool.query(
      'SELECT id, ip_address, description, created_by, created_at FROM ip_whitelist ORDER BY created_at DESC'
    );
    return result.rows;
  }

  static async create(ipAddress, description, createdBy) {
    if (!IpWhitelistService.validateIp(ipAddress)) {
      const error = new Error(`Invalid IP address: ${ipAddress}`);
      error.statusCode = 400;
      error.code = 'INVALID_IP';
      throw error;
    }

    const result = await pool.query(
      `INSERT INTO ip_whitelist (ip_address, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, ip_address, description, created_by, created_at`,
      [ipAddress, description || '', createdBy]
    );
    IpWhitelistService.clearCache();
    return result.rows[0];
  }

  static async delete(id) {
    const result = await pool.query(
      'DELETE FROM ip_whitelist WHERE id = $1 RETURNING id, ip_address',
      [id]
    );
    if (result.rows.length === 0) {
      const error = new Error('Whitelisted IP not found');
      error.statusCode = 404;
      error.code = 'IP_NOT_FOUND';
      throw error;
    }
    IpWhitelistService.clearCache();
    return result.rows[0];
  }

  static async isWhitelisted(ipAddress) {
    const cached = whitelistCache.get(ipAddress);
    if (cached && Date.now() - cached.timestamp < WHITELIST_CACHE_TTL) {
      return cached.value;
    }
    const result = await pool.query(
      'SELECT 1 FROM ip_whitelist WHERE ip_address = $1',
      [ipAddress]
    );
    const value = result.rows.length > 0;
    whitelistCache.set(ipAddress, { value, timestamp: Date.now() });
    return value;
  }

  static validateIp(ip) {
    const version = net.isIP(ip);
    return version === 4 || version === 6;
  }
}

module.exports = IpWhitelistService;
