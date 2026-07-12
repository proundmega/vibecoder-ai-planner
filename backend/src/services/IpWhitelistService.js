const { pool } = require('../db');

class IpWhitelistService {
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
    return result.rows[0];
  }

  static async isWhitelisted(ipAddress) {
    const result = await pool.query(
      'SELECT 1 FROM ip_whitelist WHERE ip_address = $1',
      [ipAddress]
    );
    return result.rows.length > 0;
  }

  static validateIp(ip) {
    const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4.test(ip) || ipv6.test(ip);
  }
}

module.exports = IpWhitelistService;
