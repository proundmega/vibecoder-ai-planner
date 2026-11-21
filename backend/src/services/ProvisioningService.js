const { Client } = require('ssh2');
const { pool } = require('../db');
const CredentialService = require('./CredentialService');
const logger = require('../utils/logger');
const { UtilityError } = require('../errors/HttpError');

function shellEscape(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

class ProvisioningService {
  async getNode(id) {
    const result = await pool.query('SELECT * FROM compute_nodes WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new UtilityError('Compute node not found', 404);
    return result.rows[0];
  }

  async getKey(node) {
    return await CredentialService.decryptKey(node.ssh_key_credential_id);
  }

  async connect(node, key) {
    const ssh = new Client();
    await new Promise((resolve, reject) => {
      ssh.on('ready', resolve);
      ssh.on('error', reject);
      ssh.connect({
        host: node.hostname,
        port: node.ssh_port || 22,
        username: node.ssh_user,
        privateKey: key,
        readyTimeout: 10000,
      });
    });
    return ssh;
  }

  async exec(ssh, command) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      ssh.exec(command, (err, stream) => {
        if (err) { ssh.end(); reject(err); return; }
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          ssh.end();
          resolve({ stdout, stderr, exitCode: code });
        });
      });
    });
  }

  async testConnection(nodeId) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    let ssh;
    try {
      ssh = await this.connect(node, key);
      await this.exec(ssh, 'docker info');
      await pool.query(
        'UPDATE compute_nodes SET status = $1, failure_count = 0, last_seen = NOW() WHERE id = $2',
        ['online', nodeId]
      );
      return { success: true };
    } catch (err) {
      const newCount = (node.failure_count || 0) + 1;
      const newStatus = newCount >= 3 ? 'offline' : 'degraded';
      await pool.query(
        'UPDATE compute_nodes SET status = $1, failure_count = $2, last_seen = NOW() WHERE id = $3',
        [newStatus, newCount, nodeId]
      );
      return { success: false, error: err.message, failureCount: newCount };
    } finally {
      if (ssh) try { ssh.end(); } catch { /* ignore */ }
    }
  }

}

module.exports = new ProvisioningService();
