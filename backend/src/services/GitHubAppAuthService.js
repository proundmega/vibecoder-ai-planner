const fs = require('fs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');
const { GitHubProvider } = require('../providers/github');
const {
  ValidationError,
  ForbiddenError,
  ServiceUnavailableError,
} = require('../errors/HttpError');

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TTL_SECONDS = 3600;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const APP_JWT_TTL_SECONDS = 540;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 3600;

const APP_PERMISSIONS = Object.freeze({
  contents: 'write',
  pull_requests: 'write',
  checks: 'read',
  metadata: 'read',
});

function readPrivateKey(raw) {
  if (!raw) return null;
  const value = String(raw);
  if (value.startsWith('file:')) {
    return fs.readFileSync(value.slice('file:'.length), 'utf8');
  }
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

function parseTtlSeconds(raw) {
  const parsed = parseInt(raw || String(DEFAULT_TTL_SECONDS), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, parsed));
}

function normalizeRepo(value) {
  if (!value) return null;
  const parsed = GitHubProvider.parseRepoUrl(String(value).replace(/\.git$/, ''));
  return `${parsed.owner}/${parsed.repo}`;
}

function normalizeAllowlist(entries) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (const entry of entries) {
    const text = String(entry || '').trim().replace(/\.git$/, '');
    if (!text) continue;
    if (text.includes('/') || text.includes(':')) {
      try {
        const repo = normalizeRepo(text);
        if (repo) normalized.push(repo.toLowerCase());
      } catch {
        // Ignore malformed allowlist entries; an empty match fails closed.
      }
    } else if (/^[A-Za-z0-9._-]+$/.test(text)) {
      normalized.push(text.toLowerCase());
    }
  }
  return [...new Set(normalized)];
}

function repoAllowed(fullRepo, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  const repoName = fullRepo.split('/')[1].toLowerCase();
  const full = fullRepo.toLowerCase();
  return allowlist.some((entry) => {
    const value = String(entry).toLowerCase();
    return value === full || value === repoName;
  });
}

async function httpRequest(method, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    const response = await fetch(url, {
      method,
      headers: { 'User-Agent': 'vibecode-ai-planner', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { ok: response.ok, status: response.status, data, text };
  } finally {
    clearTimeout(timeout);
  }
}

class GitHubAppAuthService {
  constructor(options = {}) {
    this.db = options.db || pool;
    this.log = options.log || logger;
    this.request = options.request || httpRequest;
    this.now = options.now || (() => Date.now());
    this.cache = new Map();
    this.permissions = options.permissions || { ...APP_PERMISSIONS };
  }

  readConfig() {
    const mode = String(process.env.GITHUB_AUTH_MODE || 'app').toLowerCase();
    let privateKey = null;
    let privateKeyError = null;
    if (mode === 'app' && process.env.GITHUB_APP_PRIVATE_KEY) {
      try {
        privateKey = readPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY);
      } catch (error) {
        privateKeyError = error.message;
      }
    }
    return {
      mode,
      allowPat: process.env.ALLOW_PAT === 'true',
      appId: process.env.GITHUB_APP_ID || null,
      privateKey,
      privateKeyError,
      singleInstallationId: process.env.GITHUB_APP_INSTALLATION_ID || null,
      ttlSeconds: parseTtlSeconds(process.env.GITHUB_TOKEN_TTL_SECONDS),
    };
  }

  getAuthMode() {
    const { mode } = this.readConfig();
    if (mode !== 'app' && mode !== 'pat') {
      throw new ServiceUnavailableError(
        `Unsupported GITHUB_AUTH_MODE '${mode}'; expected 'app' or 'pat'`
      );
    }
    return mode;
  }

  isPatAllowed() {
    return this.readConfig().allowPat;
  }

  async getInstallation(projectId) {
    const result = await this.db.query(
      `SELECT project_id, installation_id, repo_allowlist, disabled_at, created_at, updated_at
         FROM project_github_installations
        WHERE project_id = $1`,
      [projectId]
    );
    return result.rows[0] || null;
  }

  async setInstallation(projectId, installationId, repoAllowlist = []) {
    const result = await this.db.query(
      `INSERT INTO project_github_installations
         (project_id, installation_id, repo_allowlist, disabled_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (project_id) DO UPDATE
       SET installation_id = $2,
           repo_allowlist = $3,
           disabled_at = NULL,
           updated_at = NOW()
       RETURNING project_id, installation_id, repo_allowlist, disabled_at, created_at, updated_at`,
      [projectId, installationId, normalizeAllowlist(repoAllowlist)]
    );
    this.clearCacheForProject(projectId);
    return this.formatInstallation(result.rows[0]);
  }

  async getInstallationStatus(projectId) {
    const row = await this.getInstallation(projectId);
    return row ? this.formatInstallation(row) : null;
  }

  async disableProject(projectId) {
    const existing = await this.getInstallation(projectId);
    if (!existing) {
      throw new ValidationError('No GitHub App installation is configured for this project');
    }

    // Collect the project's cached installation tokens before clearing the
    // cache; each can be revoked with DELETE /installation/token.
    const cachedTokens = new Set();
    for (const entry of this.cache.values()) {
      if (entry.projectId === Number(projectId) && entry.result?.token) {
        cachedTokens.add(entry.result.token);
      }
    }

    await this.db.query(
      `UPDATE project_github_installations
          SET disabled_at = NOW(), updated_at = NOW()
        WHERE project_id = $1`,
      [projectId]
    );
    this.clearCacheForProject(projectId);

    let revoked = 0;
    for (const token of cachedTokens) {
      try {
        const response = await this.request(
          'DELETE',
          `${GITHUB_API_BASE}/installation/token`,
          {
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
              'X-GitHub-Api-Version': '2022-11-28',
            },
          }
        );
        if (response.ok) {
          revoked += 1;
        } else {
          this.log.warn('github_app_installation_revoke_failed', {
            projectId,
            installationId: existing.installation_id,
            status: response.status,
          });
        }
      } catch (error) {
        this.log.warn('github_app_installation_revoke_failed', {
          projectId,
          installationId: existing.installation_id,
          error: error.message,
        });
      }
    }
    if (cachedTokens.size === 0) {
      this.log.warn('github_app_disable_no_cached_token', {
        projectId,
        installationId: existing.installation_id,
      });
    }

    this.log.info('github_app_access_disabled', {
      projectId,
      installationId: existing.installation_id,
      revoked,
      cachedTokens: cachedTokens.size,
    });
    return { disabled: true, revoked, cachedTokens: cachedTokens.size };
  }

  async assertProjectEnabled(projectId) {
    const row = await this.getInstallation(projectId);
    if (row && row.disabled_at) {
      const error = new ForbiddenError('GitHub access is disabled for this project');
      error.code = 'GITHUB_ACCESS_DISABLED';
      throw error;
    }
  }

  clearCacheForProject(projectId) {
    const id = Number(projectId);
    for (const [key, entry] of this.cache.entries()) {
      if (entry.projectId === id) this.cache.delete(key);
    }
  }

  async mintToken(projectId, options = {}) {
    const config = this.readConfig();
    if (config.mode === 'pat') return this.mintPat(projectId, options);
    if (config.mode === 'app') return this.mintApp(projectId, options);
    throw new ServiceUnavailableError(
      `Unsupported GITHUB_AUTH_MODE '${config.mode}'; expected 'app' or 'pat'`
    );
  }

  async mintPat(projectId, options = {}) {
    const operation = options.operation || 'unknown';
    await this.assertProjectEnabled(projectId);
    if (!this.readConfig().allowPat) {
      const error = new ForbiddenError(
        'PAT fallback is disabled; configure a GitHub App or set ALLOW_PAT=true for local development'
      );
      error.code = 'PAT_FALLBACK_DISABLED';
      throw error;
    }

    const result = await this.db.query(
      `SELECT repo_url, access_token_encrypted
         FROM project_repos
        WHERE project_id = $1 AND is_active = TRUE`,
      [projectId]
    );
    if (result.rows.length === 0) {
      throw new ValidationError('No repository connected to this project');
    }

    const row = result.rows[0];
    const repo = this.resolveRepo(row.repo_url, options.repo);
    if (!row.access_token_encrypted) {
      throw new ValidationError('The connected repository has no stored PAT');
    }

    const token = decrypt(row.access_token_encrypted);
    this.audit('issued', {
      projectId: Number(projectId),
      mode: 'pat',
      repo: repo.full,
      installationId: null,
      operation,
      expiresAt: null,
    });
    return {
      token,
      expiresAt: null,
      mode: 'pat',
      repoUrl: row.repo_url,
      repo: repo.full,
      permissions: {},
      installationId: null,
    };
  }

  async mintApp(projectId, options = {}) {
    const operation = options.operation || 'unknown';
    const config = this.readConfig();
    if (!config.appId || !config.privateKey || config.privateKeyError) {
      const error = new ServiceUnavailableError(
        'GitHub App credentials are not configured or the private key is unreadable'
      );
      error.code = 'GITHUB_APP_NOT_CONFIGURED';
      throw error;
    }

    const installation = await this.resolveInstallation(projectId);
    const result = await this.db.query(
      `SELECT repo_url
         FROM project_repos
        WHERE project_id = $1 AND is_active = TRUE`,
      [projectId]
    );
    if (result.rows.length === 0) {
      throw new ValidationError('No repository connected to this project');
    }

    const repo = this.resolveRepo(result.rows[0].repo_url, options.repo);
    if (!repoAllowed(repo.full, installation.repoAllowlist)) {
      const error = new ForbiddenError(
        `Repository ${repo.full} is not allowlisted for project ${projectId}`
      );
      error.code = 'GITHUB_REPO_NOT_ALLOWED';
      throw error;
    }

    const cacheKey = `${Number(projectId)}:${installation.installationId}:${repo.full}`;
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (
      cached &&
      cached.projectId === Number(projectId) &&
      now < cached.refreshAt
    ) {
      return { ...cached.result, cached: true };
    }

    let appJwt;
    try {
      appJwt = this.createAppJwt(config);
    } catch (error) {
      const configError = new ServiceUnavailableError(
        'GitHub App private key is not a valid RS256 key'
      );
      configError.code = 'GITHUB_APP_NOT_CONFIGURED';
      throw configError;
    }

    let response;
    try {
      response = await this.request(
        'POST',
        `${GITHUB_API_BASE}/app/installations/${installation.installationId}/access_tokens`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${appJwt}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: {
            repositories: [repo.repo],
            permissions: this.permissions,
          },
        }
      );
    } catch (error) {
      const mintError = new ServiceUnavailableError(
        'GitHub installation token request failed; check backend connectivity'
      );
      mintError.code = 'GITHUB_TOKEN_MINT_FAILED';
      this.audit('failed', {
        projectId: Number(projectId),
        mode: 'app',
        repo: repo.full,
        installationId: installation.installationId,
        operation,
        error: error.name || 'network_error',
      });
      throw mintError;
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      const error = new ForbiddenError(
        'GitHub rejected the installation token request; check the App installation and permissions'
      );
      error.code = 'GITHUB_INSTALLATION_REJECTED';
      this.audit('failed', {
        projectId: Number(projectId),
        mode: 'app',
        repo: repo.full,
        installationId: installation.installationId,
        operation,
        status: response.status,
      });
      throw error;
    }
    if (!response.ok) {
      const error = new ServiceUnavailableError(
        `GitHub installation token request failed (status ${response.status})`
      );
      error.code = 'GITHUB_TOKEN_MINT_FAILED';
      this.audit('failed', {
        projectId: Number(projectId),
        mode: 'app',
        repo: repo.full,
        installationId: installation.installationId,
        operation,
        status: response.status,
      });
      throw error;
    }

    const data = response.data || {};
    if (!data.token) {
      const error = new ServiceUnavailableError(
        'GitHub did not return an installation token'
      );
      error.code = 'GITHUB_TOKEN_MINT_FAILED';
      throw error;
    }

    const expiresAtMs = this.parseExpiry(data.expires_at, now + config.ttlSeconds * 1000);
    const ttlCap = now + config.ttlSeconds * 1000;
    const validUntil = Math.min(expiresAtMs, ttlCap);
    const tokenResult = {
      token: data.token,
      expiresAt: new Date(validUntil).toISOString(),
      mode: 'app',
      repoUrl: result.rows[0].repo_url,
      repo: repo.full,
      permissions: data.permissions || this.permissions,
      installationId: installation.installationId,
    };

    this.cache.set(cacheKey, {
      projectId: Number(projectId),
      refreshAt: validUntil - REFRESH_SKEW_MS,
      result: tokenResult,
    });

    this.audit('issued', {
      projectId: Number(projectId),
      mode: 'app',
      repo: repo.full,
      installationId: installation.installationId,
      operation,
      expiresAt: tokenResult.expiresAt,
      permissions: Object.keys(tokenResult.permissions || {}),
    });
    return tokenResult;
  }

  createAppJwt(config) {
    const nowSeconds = Math.floor(this.now() / 1000);
    return jwt.sign(
      {
        iat: nowSeconds - 60,
        exp: nowSeconds + APP_JWT_TTL_SECONDS,
        iss: String(config.appId),
      },
      config.privateKey,
      { algorithm: 'RS256' }
    );
  }

  async resolveInstallation(projectId) {
    const config = this.readConfig();
    const row = await this.getInstallation(projectId);
    if (row) {
      if (row.disabled_at) {
        const error = new ForbiddenError('GitHub access is disabled for this project');
        error.code = 'GITHUB_ACCESS_DISABLED';
        throw error;
      }
      return {
        installationId: Number(row.installation_id),
        repoAllowlist: normalizeAllowlist(row.repo_allowlist),
      };
    }

    if (config.singleInstallationId) {
      const installationId = Number(config.singleInstallationId);
      if (!Number.isSafeInteger(installationId) || installationId <= 0) {
        const error = new ServiceUnavailableError(
          'GITHUB_APP_INSTALLATION_ID must be a positive integer'
        );
        error.code = 'GITHUB_APP_NOT_CONFIGURED';
        throw error;
      }
      return { installationId, repoAllowlist: [] };
    }

    const error = new ForbiddenError(
      'No GitHub App installation is configured for this project'
    );
    error.code = 'GITHUB_INSTALLATION_NOT_CONFIGURED';
    throw error;
  }

  resolveRepo(repoUrl, requestedRepo) {
    const parsed = GitHubProvider.parseRepoUrl(repoUrl.replace(/\.git$/, ''));
    const full = `${parsed.owner}/${parsed.repo}`;
    if (requestedRepo) {
      let requested;
      try {
        requested = normalizeRepo(requestedRepo);
      } catch {
        throw new ValidationError('Requested repository is not a valid owner/repo value');
      }
      if (requested.toLowerCase() !== full.toLowerCase()) {
        const error = new ForbiddenError(
          `Requested repository ${requested} does not match the connected repository ${full}`
        );
        error.code = 'GITHUB_REPO_SCOPE_MISMATCH';
        throw error;
      }
    }
    return { owner: parsed.owner, repo: parsed.repo, full, repoUrl };
  }

  parseExpiry(value, fallbackMs) {
    if (value === null || value === undefined || value === '') return fallbackMs;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallbackMs;
  }

  audit(outcome, fields) {
    const event = `github_app_token_${outcome}`;
    const payload = { ...fields, outcome };
    if (outcome === 'issued') {
      this.log.info(event, payload);
    } else {
      this.log.warn(event, payload);
    }
  }

  formatInstallation(row) {
    return {
      projectId: row.project_id,
      installationId: Number(row.installation_id),
      repoAllowlist: row.repo_allowlist || [],
      disabled: Boolean(row.disabled_at),
      disabledAt: row.disabled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

const service = new GitHubAppAuthService();
service.GitHubAppAuthService = GitHubAppAuthService;

module.exports = service;
