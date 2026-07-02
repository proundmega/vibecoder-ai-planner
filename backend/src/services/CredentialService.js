const { pool } = require('../db');
const { encrypt, decrypt, maskToken } = require('../utils/crypto');

class CredentialService {
  static async addCredential(projectId, name, credentialType, key, metadata, userId) {
    const masked = maskToken(key);
    const encrypted = encrypt(key);

    const result = await pool.query(
      `INSERT INTO project_credentials (project_id, name, credential_type, key_encrypted, key_masked, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [projectId, name, credentialType, encrypted, masked, metadata || '{}', userId]
    );

    return result.rows[0];
  }

  static async listCredentials(projectId) {
    const result = await pool.query(
      `SELECT id, project_id, name, credential_type, key_masked, metadata, expires_at, is_active, created_at, updated_at
       FROM project_credentials
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );

    return result.rows;
  }

  static async getCredential(projectId, credentialId) {
    const result = await pool.query(
      `SELECT * FROM project_credentials
       WHERE id = $1 AND project_id = $2`,
      [credentialId, projectId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  static async updateCredential(credentialId, updates) {
    const { name, credentialType, key, metadata, expiresAt, isActive } = updates;
    const setClauses = [];
    const values = [];
    let param = 1;

    if (name !== undefined) {
      setClauses.push(`name = $${param++}`);
      values.push(name);
    }
    if (credentialType !== undefined) {
      setClauses.push(`credential_type = $${param++}`);
      values.push(credentialType);
    }
    if (key !== undefined) {
      setClauses.push(`key_encrypted = $${param++}`);
      values.push(encrypt(key));
      setClauses.push(`key_masked = $${param++}`);
      values.push(maskToken(key));
    }
    if (metadata !== undefined) {
      setClauses.push(`metadata = $${param++}`);
      values.push(JSON.stringify(metadata));
    }
    if (expiresAt !== undefined) {
      setClauses.push(`expires_at = $${param++}`);
      values.push(expiresAt);
    }
    if (isActive !== undefined) {
      setClauses.push(`is_active = $${param++}`);
      values.push(isActive);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(credentialId);

    const result = await pool.query(
      `UPDATE project_credentials SET ${setClauses.join(', ')} WHERE id = $${param} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  static async deleteCredential(credentialId) {
    const result = await pool.query(
      `UPDATE project_credentials SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_active = true
       RETURNING *`,
      [credentialId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  static async rotateCredential(projectId, credentialId, newKey, userId) {
    const masked = maskToken(newKey);
    const encrypted = encrypt(newKey);

    await pool.query(
      `UPDATE project_credentials SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [credentialId]
    );

    const result = await pool.query(
      `INSERT INTO project_credentials (project_id, name, credential_type, key_encrypted, key_masked, created_by)
       SELECT project_id, name, credential_type, $2, $3, $4
       FROM project_credentials WHERE id = $1
       RETURNING *`,
      [credentialId, encrypted, masked, userId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  static async getDecryptedKey(projectId, credentialType) {
    const result = await pool.query(
      `SELECT key_encrypted FROM project_credentials
       WHERE project_id = $1 AND credential_type = $2 AND is_active = true
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, credentialType]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return decrypt(result.rows[0].key_encrypted);
  }

  static async decryptKey(credentialId) {
    const { NotFoundError } = require('../errors/HttpError');
    const result = await pool.query(
      'SELECT key_encrypted FROM project_credentials WHERE id = $1',
      [credentialId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Credential not found');
    }
    return decrypt(result.rows[0].key_encrypted);
  }

  static async getActiveCredentials(projectId) {
    const result = await pool.query(
      `SELECT id, name, credential_type, key_masked, metadata, expires_at, is_active, created_at, updated_at
       FROM project_credentials
       WHERE project_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [projectId]
    );

    return result.rows;
  }

}

module.exports = CredentialService;
