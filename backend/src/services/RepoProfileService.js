const crypto = require('crypto');
const { pool } = require('../db');
const Project = require('../models/project');
const GitHubService = require('./GitHubService');
const { encrypt, decrypt } = require('../utils/crypto');
const { redactProfile } = require('../utils/repoProfileRedaction');
const logger = require('../utils/logger');
const {
  validateRepoProfile, normalizeExactHost,
} = require('../validators/repoProfiles');
const {
  selectStackImage, stackImagesFromEnv,
} = require('../config/stackImages');
const {
  NotFoundError, ForbiddenError, ValidationError,
} = require('../errors/HttpError');

const WRITE_ROLES = new Set(['super_admin']);
const MAX_MTLS_BYTES = 32 * 1024;
const MTLS_KIND = 'mtls-client';

function isSuperAdmin(user) {
  return Boolean(user && WRITE_ROLES.has(user.role));
}

async function assertProjectExists(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found');
  return project;
}

async function assertCanRead(projectId, user) {
  const project = await assertProjectExists(projectId);
  if (isSuperAdmin(user)) return project;
  const userId = user?.userId || user?.id;
  if (userId && String(project.ownerId) === String(userId)) return project;
  if (userId) {
    const membership = await pool.query(
      'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    if (membership.rows.length > 0) return project;
  }
  throw new ForbiddenError('Not a member of this project');
}

async function assertCanWrite(projectId, user) {
  const project = await assertProjectExists(projectId);
  if (isSuperAdmin(user)) return project;
  const userId = user?.userId || user?.id;
  if (userId && String(project.ownerId) === String(userId)) return project;
  throw new ForbiddenError('Only the project owner or a super admin can change the repo profile');
}

async function canWrite(projectId, user) {
  try {
    await assertCanWrite(projectId, user);
    return true;
  } catch {
    return false;
  }
}

async function assertAgentProjectAccess(projectId, agent) {
  const project = await assertProjectExists(projectId);
  const requesterId = agent?.owner_id;
  const role = agent?.role;
  if (WRITE_ROLES.has(role)) return project;
  if (requesterId && String(project.ownerId) === String(requesterId)) return project;
  throw new ForbiddenError('Only the project owner or a super admin can access agent repo profiles');
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function profileHash(profile) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(profile)))
    .digest('hex');
}

function format(row, options = {}) {
  return {
    id: row.id,
    project_id: row.project_id,
    version: row.version,
    profile: options.redact === false ? row.profile : redactProfile(row.profile),
    profile_hash: row.profile_hash,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    activated_at: row.activated_at,
  };
}

function normalizeProfile(profile, repo) {
  const candidate = { ...profile };
  if (!candidate.repo_url && repo?.repoUrl) {
    candidate.repo_url = String(repo.repoUrl).replace(/\.git$/, '');
  }
  if (!candidate.base_branch && repo?.defaultBranch) {
    candidate.base_branch = repo.defaultBranch;
  }
  return candidate;
}

function compareRepoUrl(profileRepoUrl, connectedRepoUrl) {
  const normalize = (value) => String(value || '')
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalize(profileRepoUrl) === normalize(connectedRepoUrl);
}

function assertRepoMatches(profile, repo) {
  if (!repo?.repoUrl) {
    throw new ValidationError(
      'Connect an active repository before creating or editing a repo profile');
  }
  if (!profile.repo_url) {
    throw new ValidationError('profile repo_url is required');
  }
  if (!compareRepoUrl(profile.repo_url, repo.repoUrl)) {
    throw new ValidationError(
      'profile repo_url must match the repository connected to the project');
  }
}

async function assertProfileRepoBinding(projectId, profile) {
  const repo = await GitHubService.getProjectRepo(projectId);
  assertRepoMatches(profile, repo);
}

async function readOptionalFile(projectId, path) {
  try {
    return await GitHubService.readRepoFile(projectId, path);
  } catch (error) {
    if (error && (error.status === 404 || /not found/i.test(error.message || ''))) {
      return null;
    }
    throw error;
  }
}

function hasScript(pkg, name) {
  return Boolean(pkg && pkg.scripts && typeof pkg.scripts[name] === 'string');
}

function nodeVerifyCommands(pkg, prefix) {
  const commands = [];
  const cd = prefix ? `cd ${prefix} && ` : '';
  if (hasScript(pkg, 'test')) {
    let test = `${cd}npm test`;
    if (/vitest/i.test(pkg.scripts.test) && !/--run\b|\brun\b/.test(pkg.scripts.test)) {
      test += ' -- --run';
    }
    commands.push(test);
  }
  if (hasScript(pkg, 'lint')) commands.push(`${cd}npm run lint`);
  if (hasScript(pkg, 'typecheck')) commands.push(`${cd}npm run typecheck`);
  return commands;
}

async function detectNodeSubpackages(projectId, warnings) {
  const setup = [];
  const verify = [];
  for (const dir of ['backend', 'frontend']) {
    const content = await readOptionalFile(projectId, `${dir}/package.json`);
    if (!content) continue;
    let pkg;
    try {
      pkg = JSON.parse(content);
    } catch {
      warnings.push(`${dir}/package.json is not valid JSON; ${dir} commands were not proposed`);
      continue;
    }
    const hasLock = Boolean(await readOptionalFile(projectId, `${dir}/package-lock.json`));
    setup.push(hasLock
      ? `cd ${dir} && npm ci --no-audit --no-fund`
      : `cd ${dir} && npm install --no-package-lock --no-audit --no-fund`);
    verify.push(...nodeVerifyCommands(pkg, dir));
  }
  return { setup, verify };
}

async function detectNode(projectId, warnings) {
  const setup = [];
  const verify = [];
  const rootPkg = await readOptionalFile(projectId, 'package.json');
  if (rootPkg) {
    let pkg;
    try {
      pkg = JSON.parse(rootPkg);
    } catch {
      warnings.push('package.json is not valid JSON; Node commands were not proposed');
      return { setup, verify };
    }
    const hasLock = Boolean(await readOptionalFile(projectId, 'package-lock.json'))
      || Boolean(await readOptionalFile(projectId, 'npm-shrinkwrap.json'));
    setup.push(hasLock
      ? 'npm ci --no-audit --no-fund'
      : 'npm install --no-package-lock --no-audit --no-fund');
    verify.push(...nodeVerifyCommands(pkg, ''));
    if (!hasScript(pkg, 'test')) {
      // A workspace root often has no test script of its own; propose the
      // per-package commands instead of silently returning no verification.
      const sub = await detectNodeSubpackages(projectId, warnings);
      setup.push(...sub.setup);
      verify.push(...sub.verify);
    }
    return { setup, verify };
  }

  return detectNodeSubpackages(projectId, warnings);
}

async function detectStack(projectId) {
  const repo = await GitHubService.getProjectRepo(projectId);
  if (!repo) {
    throw new ValidationError('Connect a GitHub repository before detecting a profile');
  }
  const warnings = [];
  const languages = [];
  const setup = [];
  const verify = [];

  const node = await detectNode(projectId, warnings);
  if (node.verify.length > 0) languages.push('node');
  setup.push(...node.setup);
  verify.push(...node.verify);

  const pom = await readOptionalFile(projectId, 'pom.xml');
  if (pom) {
    languages.push('java');
    const wrapper = await readOptionalFile(projectId, 'mvnw');
    verify.push(wrapper ? './mvnw test -q' : 'mvn test -q');
  }

  const gradle = await readOptionalFile(projectId, 'build.gradle')
    || await readOptionalFile(projectId, 'build.gradle.kts');
  if (gradle && !languages.includes('java')) {
    languages.push('java');
  }
  if (gradle) {
    const wrapper = await readOptionalFile(projectId, 'gradlew');
    verify.push(wrapper ? './gradlew test' : 'gradle test');
  }

  const pyproject = await readOptionalFile(projectId, 'pyproject.toml');
  const requirements = await readOptionalFile(projectId, 'requirements.txt');
  if (pyproject || requirements) {
    languages.push('python');
    if (requirements) setup.push('pip install -r requirements.txt');
    else setup.push('pip install -e .');
    verify.push('pytest -q');
  }

  const goMod = await readOptionalFile(projectId, 'go.mod');
  if (goMod) {
    languages.push('go');
    setup.push('go mod download');
    verify.push('go test ./...');
  }

  const makefile = await readOptionalFile(projectId, 'Makefile');
  if (makefile && /^test\s*:/m.test(makefile) && verify.length === 0) {
    verify.push('make test');
  }

  let stackImage;
  try {
    stackImage = selectStackImage(languages, stackImagesFromEnv());
  } catch (error) {
    throw new ValidationError(error.message);
  }
  if (!stackImage && languages.length > 0) {
    warnings.push(
      'No pinned stack image is configured for the detected stack; '
      + 'set REPO_PROFILE_STACK_IMAGES or provide a digest-pinned image');
  }

  const profile = {
    schema_version: 1,
    repo_url: repo.repoUrl.replace(/\.git$/, ''),
    base_branch: repo.defaultBranch || 'main',
    languages: [...new Set(languages)],
    ...(stackImage ? { image: stackImage.image } : {}),
    setup: [...new Set(setup)],
    verify: [...new Set(verify)],
    caches: [],
    env: {},
    timeouts: { setup_minutes: 15, verify_minutes: 20 },
    max_round_minutes: 45,
    services: [],
    flaky_tests: [],
    flaky_retries: 2,
    test_data: { setup: [], cleanup: [] },
  };

  if (profile.verify.length === 0) {
    warnings.push('No supported manifest with a test command was detected; add verify commands manually');
  }

  return {
    detected: profile.verify.length > 0,
    profile,
    warnings,
  };
}


function decodeMtlsValue(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  let raw;
  try {
    raw = Buffer.from(value, 'base64');
  } catch {
    throw new ValidationError(`${field} must be valid base64`);
  }
  if (raw.length === 0 || raw.length > MAX_MTLS_BYTES) {
    throw new ValidationError(`${field} must decode to 1-32 KiB`);
  }
  return raw.toString('utf8');
}

function validateMtlsMaterial(certB64, keyB64) {
  const certPem = decodeMtlsValue(certB64, 'cert_b64');
  const keyPem = decodeMtlsValue(keyB64, 'key_b64');
  if (/PRIVATE KEY/.test(certPem)) {
    throw new ValidationError('cert_b64 must contain a certificate only');
  }
  if (!/PRIVATE KEY/.test(keyPem) || /CERTIFICATE/.test(keyPem)) {
    throw new ValidationError('key_b64 must contain a private key only');
  }
  const blocks = certPem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
  ) || [];
  if (blocks.length !== 1) {
    throw new ValidationError('cert_b64 must contain exactly one client certificate');
  }
  let certificate;
  let privateKey;
  try {
    certificate = new crypto.X509Certificate(blocks[0]);
    privateKey = crypto.createPrivateKey(keyPem);
  } catch {
    throw new ValidationError('cert_b64/key_b64 is not valid PEM material');
  }
  if (certificate.ca) {
    throw new ValidationError('cert_b64 must be a client certificate, not a CA');
  }
  const certPublic = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const keyPublic = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (!Buffer.from(certPublic).equals(Buffer.from(keyPublic))) {
    throw new ValidationError('cert_b64 does not match key_b64');
  }
  return {
    certPem,
    keyPem,
    certSha256: crypto.createHash('sha256').update(certPem, 'utf8').digest('hex'),
  };
}

function normalizeMtlsHosts(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.length > 16) {
    throw new ValidationError('hosts must contain 1-16 exact hostnames');
  }
  const normalized = [];
  for (const host of hosts) {
    const result = normalizeExactHost(host);
    if (result.error) throw new ValidationError(result.error.replace('egress.origin_ca_hosts', 'hosts'));
    if (!normalized.includes(result.host)) normalized.push(result.host);
  }
  return normalized;
}

function metadataObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function mtlsCredentialView(row) {
  const metadata = metadataObject(row.metadata);
  return {
    id: row.id,
    name: row.name,
    hosts: Array.isArray(metadata.hosts) ? metadata.hosts : [],
    cert_sha256: metadata.cert_sha256 || null,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function assertMtlsReference(projectId, egress) {
  const mtls = egress && egress.mtls;
  if (!mtls) return;
  const result = await pool.query(
    `SELECT * FROM project_credentials
     WHERE id = $1 AND project_id = $2 AND credential_type = 'custom'`,
    [mtls.credential_id, projectId]
  );
  if (result.rows.length === 0) {
    throw new ValidationError('egress.mtls.credential_id does not belong to this project');
  }
  const row = result.rows[0];
  if (!row.is_active) {
    throw new ValidationError('egress.mtls credential is inactive');
  }
  const metadata = metadataObject(row.metadata);
  if (metadata.kind !== MTLS_KIND) {
    throw new ValidationError('egress.mtls credential is not an mTLS client credential');
  }
  if (!metadata.cert_b64 || !row.key_encrypted) {
    throw new ValidationError('egress.mtls credential has no certificate/key material');
  }
  const allowed = new Set(
    normalizeMtlsHosts(metadata.hosts || [])
  );
  for (const host of normalizeMtlsHosts(mtls.hosts)) {
    if (!allowed.has(host)) {
      throw new ValidationError(
        `egress.mtls host ${host} is not scoped to the referenced credential`);
    }
  }
}

class RepoProfileService {
  async listVersions(projectId, user) {
    await assertCanRead(projectId, user);
    const raw = await canWrite(projectId, user);
    const result = await pool.query(
      `SELECT * FROM repo_profiles
       WHERE project_id = $1
       ORDER BY version DESC`,
      [projectId]
    );
    return result.rows.map((row) => format(row, { redact: !raw }));
  }

  async getCurrent(projectId, user) {
    await assertCanRead(projectId, user);
    const raw = await canWrite(projectId, user);
    const result = await pool.query(
      `SELECT * FROM repo_profiles
       WHERE project_id = $1
       ORDER BY (status = 'active') DESC, version DESC`,
      [projectId]
    );
    const rows = result.rows.map((row) => format(row, { redact: !raw }));
    return {
      active: rows.find((row) => row.status === 'active') || null,
      latest: rows[0] || null,
      versions: rows,
    };
  }

  async getActive(projectId) {
    const result = await pool.query(
      `SELECT * FROM repo_profiles
       WHERE project_id = $1 AND status = 'active'`,
      [projectId]
    );
    return result.rows.length > 0
      ? format(result.rows[0], { redact: false })
      : null;
  }

  async getActiveForAgent(projectId, agent) {
    await assertAgentProjectAccess(projectId, agent);
    return this.getActive(projectId);
  }

  async create(projectId, payload, user) {
    const project = await assertCanWrite(projectId, user);
    const repo = await GitHubService.getProjectRepo(projectId);
    const normalized = normalizeProfile(payload, repo);
    assertRepoMatches(normalized, repo);
    const result = validateRepoProfile(normalized);
    if (result.error) {
      const details = result.error.details || [];
      throw new ValidationError(
        details.map((detail) => detail.message).join('; ') || result.error.message
      );
    }
    await assertMtlsReference(projectId, result.value.egress);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [project.id]);
      const next = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM repo_profiles WHERE project_id = $1',
        [projectId]
      );
      const inserted = await client.query(
        `INSERT INTO repo_profiles
           (project_id, version, profile, profile_hash, status, created_by)
         VALUES ($1, $2, $3, $4, 'draft', $5)
         RETURNING *`,
        [
          projectId,
          next.rows[0].version,
          JSON.stringify(result.value),
          profileHash(result.value),
          user.userId || user.id,
        ]
      );
      await client.query('COMMIT');
      return format(inserted.rows[0], { redact: false });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(projectId, profileId, payload, user) {
    await assertCanWrite(projectId, user);
    const repo = await GitHubService.getProjectRepo(projectId);
    const normalized = normalizeProfile(payload, repo);
    assertRepoMatches(normalized, repo);
    const result = validateRepoProfile(normalized);
    if (result.error) {
      const details = result.error.details || [];
      throw new ValidationError(
        details.map((detail) => detail.message).join('; ') || result.error.message
      );
    }
    await assertMtlsReference(projectId, result.value.egress);

    const current = await pool.query(
      'SELECT * FROM repo_profiles WHERE id = $1 AND project_id = $2',
      [profileId, projectId]
    );
    if (current.rows.length === 0) throw new NotFoundError('Repo profile not found');
    if (current.rows[0].status !== 'draft') {
      throw new ValidationError('Only draft profiles can be edited; create a new version');
    }

    const updated = await pool.query(
      `UPDATE repo_profiles
       SET profile = $1, profile_hash = $2, updated_at = NOW()
       WHERE id = $3 AND project_id = $4 AND status = 'draft'
       RETURNING *`,
      [JSON.stringify(result.value), profileHash(result.value), profileId, projectId]
    );
    if (updated.rows.length === 0) {
      throw new ValidationError('Only draft profiles can be edited; create a new version');
    }
    return format(updated.rows[0], { redact: false });
  }

  async activate(projectId, profileId, user) {
    await assertCanWrite(projectId, user);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query(
        'SELECT * FROM repo_profiles WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [profileId, projectId]
      );
      if (target.rows.length === 0) throw new NotFoundError('Repo profile not found');
      await assertProfileRepoBinding(projectId, target.rows[0].profile);
      let contentHash = target.rows[0].profile_hash;
      if (!contentHash) {
        contentHash = profileHash(target.rows[0].profile);
        await client.query(
          `UPDATE repo_profiles
           SET profile_hash = $1, updated_at = NOW()
           WHERE id = $2 AND project_id = $3`,
          [contentHash, profileId, projectId]
        );
      }
      if (target.rows[0].status === 'active') {
        await client.query('COMMIT');
        return format({ ...target.rows[0], profile_hash: contentHash }, { redact: false });
      }
      const validated = await client.query(
        `SELECT 1 FROM repo_profile_validations
         WHERE profile_id = $1 AND status = 'succeeded' AND profile_hash = $2
         LIMIT 1`,
        [profileId, contentHash]
      );
      if (validated.rows.length === 0) {
        throw new ValidationError(
          'A successful dry run is required for this exact profile content');
      }
      await client.query(
        `UPDATE repo_profiles
         SET status = 'inactive', updated_at = NOW()
         WHERE project_id = $1 AND status = 'active'`,
        [projectId]
      );
      const activated = await client.query(
        `UPDATE repo_profiles
         SET status = 'active', activated_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND project_id = $2
         RETURNING *`,
        [profileId, projectId]
      );
      await client.query('COMMIT');
      return format(activated.rows[0], { redact: false });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createMtlsCredential(projectId, payload, user) {
    await assertCanWrite(projectId, user);
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (!name || name.length > 100) {
      throw new ValidationError('name must be 1-100 characters');
    }
    const hosts = normalizeMtlsHosts(payload?.hosts);
    const material = validateMtlsMaterial(payload?.cert_b64, payload?.key_b64);
    const metadata = {
      kind: MTLS_KIND,
      hosts,
      cert_b64: Buffer.from(material.certPem, 'utf8').toString('base64'),
      cert_sha256: material.certSha256,
    };
    const inserted = await pool.query(
      `INSERT INTO project_credentials
         (project_id, name, credential_type, key_encrypted, key_masked, metadata, created_by)
       VALUES ($1, $2, 'custom', $3, $4, $5, $6)
       RETURNING *`,
      [
        projectId,
        name,
        encrypt(material.keyPem),
        '[redacted]',
        JSON.stringify(metadata),
        user.userId || user.id,
      ]
    );
    logger.info('Stored repo-profile mTLS credential {} for project {} hosts={} certSha256={}',
      inserted.rows[0].id, projectId, hosts.join(','), material.certSha256);
    return mtlsCredentialView(inserted.rows[0]);
  }

  async listMtlsCredentials(projectId, user) {
    await assertCanRead(projectId, user);
    const result = await pool.query(
      `SELECT * FROM project_credentials
       WHERE project_id = $1
         AND credential_type = 'custom'
         AND metadata->>'kind' = $2
       ORDER BY created_at DESC`,
      [projectId, MTLS_KIND]
    );
    return result.rows.map(mtlsCredentialView);
  }

  async deleteMtlsCredential(projectId, credentialId, user) {
    await assertCanWrite(projectId, user);
    const inUse = await pool.query(
      `SELECT 1 FROM repo_profiles
       WHERE project_id = $1
         AND status IN ('draft', 'active')
         AND profile->'egress'->'mtls'->>'credential_id' = $2
       LIMIT 1`,
      [projectId, String(credentialId)]
    );
    if (inUse.rows.length > 0) {
      throw new ValidationError(
        'mTLS credential is still referenced by a draft or active repo profile');
    }
    const result = await pool.query(
      `UPDATE project_credentials
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND project_id = $2
         AND credential_type = 'custom' AND metadata->>'kind' = $3
       RETURNING *`,
      [credentialId, projectId, MTLS_KIND]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('mTLS credential not found');
    }
    logger.info('Deactivated repo-profile mTLS credential {} for project {}',
      credentialId, projectId);
    return mtlsCredentialView(result.rows[0]);
  }

  async getMtlsMaterialForAgent(projectId, agent, profileId = null, profileVersion = null) {
    await assertAgentProjectAccess(projectId, agent);
    let profile;
    if (profileId != null || profileVersion != null) {
      if (profileId == null || profileVersion == null) {
        throw new ValidationError('profileId and profileVersion must be provided together');
      }
      const profileResult = await pool.query(
        `SELECT * FROM repo_profiles
         WHERE id = $1 AND project_id = $2 AND version = $3`,
        [profileId, projectId, profileVersion]
      );
      if (profileResult.rows.length === 0) {
        throw new NotFoundError('Repo profile not found');
      }
      profile = profileResult.rows[0];
    } else {
      profile = await this.getActive(projectId);
    }
    const mtls = profile?.profile?.egress?.mtls;
    if (!mtls) return null;
    const result = await pool.query(
      `SELECT * FROM project_credentials
       WHERE id = $1 AND project_id = $2 AND credential_type = 'custom'`,
      [mtls.credential_id, projectId]
    );
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      throw new ValidationError('Active repo profile mTLS credential is missing or inactive');
    }
    const row = result.rows[0];
    const metadata = metadataObject(row.metadata);
    if (metadata.kind !== MTLS_KIND || !metadata.cert_b64 || !row.key_encrypted) {
      throw new ValidationError('Active repo profile mTLS credential is invalid');
    }
    const allowed = new Set(normalizeMtlsHosts(metadata.hosts || []));
    const effectiveHosts = normalizeMtlsHosts(mtls.hosts);
    for (const host of effectiveHosts) {
      if (!allowed.has(host)) {
        throw new ValidationError(
          `Profile mTLS host ${host} is not scoped to its credential`);
      }
    }
    logger.info('Released repo-profile mTLS material for project {} profile {} credential {} hosts={} certSha256={}',
      projectId, profile.id, row.id, effectiveHosts.join(','), metadata.cert_sha256 || '');
    return {
      profile_id: profile.id,
      profile_version: profile.version,
      credential_id: row.id,
      hosts: effectiveHosts,
      cert_b64: metadata.cert_b64,
      key_b64: Buffer.from(decrypt(row.key_encrypted), 'utf8').toString('base64'),
      cert_sha256: metadata.cert_sha256 || null,
    };
  }

  async detect(projectId, user) {
    await assertCanWrite(projectId, user);
    return detectStack(projectId);
  }
}

const service = new RepoProfileService();

module.exports = service;
module.exports.assertCanRead = assertCanRead;
module.exports.assertCanWrite = assertCanWrite;
module.exports.canWrite = canWrite;
module.exports.assertAgentProjectAccess = assertAgentProjectAccess;
module.exports.assertProjectExists = assertProjectExists;
module.exports.format = format;
module.exports.detectStack = detectStack;
module.exports.assertProfileRepoBinding = assertProfileRepoBinding;
module.exports.profileHash = profileHash;
module.exports.assertMtlsReference = assertMtlsReference;
