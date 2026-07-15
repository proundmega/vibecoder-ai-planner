const { Client } = require('ssh2');
const { pool } = require('../db');
const CredentialService = require('./CredentialService');
const logger = require('../utils/logger');
const { UtilityError } = require('../errors/HttpError');
const PoolManager = require('./PoolManager');

function shellEscape(str) {
  return str.replace(/'/g, "'\"'\"'").replace(/"/g, '\\"');
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

  async spawnAgent(nodeId, env) {
    // Resolve provider config if provider_id is provided
    if (env.provider_id) {
      try {
        const providerConfig = await PoolManager.resolveProviderConfig(env.provider_id);
        env.AI_PROVIDER = providerConfig.provider_type;
        env.AI_MAX_TOKENS = providerConfig.max_tokens || 4096;
        if (providerConfig.model) {
          env.AI_MODEL = providerConfig.model;
        }
        if (providerConfig.api_key) {
          env.AI_API_KEY = providerConfig.api_key;
        }
        if (providerConfig.base_url) {
          env.AI_ENDPOINT_URL = providerConfig.base_url;
        }
      } catch (err) {
        throw new Error(`Provider resolution failed for remote spawn: ${err.message}`);
      }
      delete env.provider_id;
    }

    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    const ssh = await this.connect(node, key);

    const envFlags = Object.entries(env)
      .map(([k, v]) => `-e ${k}="${shellEscape(String(v))}"`)
      .join(' ');

    const cmd = `docker run -d --name agent-${env.id} ` +
      `--restart unless-stopped ` +
      `${envFlags} ` +
      `vibecode-agent:latest`;

    const { stdout, stderr, exitCode } = await this.exec(ssh, cmd);

    await pool.query(
      'UPDATE compute_nodes SET last_seen = NOW(), failure_count = 0 WHERE id = $1',
      [nodeId]
    );

    if (exitCode !== 0) {
      if (stderr.includes('pull access denied') || stderr.includes('not found')) {
        logger.info('Pulling image on %s...', node.hostname);
        await this.exec(ssh, 'docker pull vibecode-agent:latest');
        const retry = await this.exec(ssh, cmd);
        if (retry.exitCode !== 0) throw new Error(`docker run failed on ${node.hostname}: ${retry.stderr}`);
        return retry.stdout.trim();
      }
      throw new Error(`docker run failed on ${node.hostname}: ${stderr}`);
    }

    return stdout.trim();
  }

  async destroyAgent(nodeId, containerId) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    const ssh = await this.connect(node, key);
    await this.exec(ssh, `docker stop ${containerId} && docker rm ${containerId}`);
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

  async getRunningContainers(nodeId) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    const ssh = await this.connect(node, key);
    const { stdout } = await this.exec(ssh, `docker ps --filter "name=agent-" --format "{{.ID}} {{.Names}}"`);
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, ...nameParts] = line.split(' ');
      return { id, name: nameParts.join(' ') };
    });
  }
}

module.exports = new ProvisioningService();
