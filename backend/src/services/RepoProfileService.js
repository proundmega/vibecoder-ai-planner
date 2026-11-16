const crypto = require('crypto');
const { pool } = require('../db');
const Project = require('../models/project');
const GitHubService = require('./GitHubService');
const { validateRepoProfile } = require('../validators/repoProfiles');
const {
  NotFoundError, ForbiddenError, ValidationError,
} = require('../errors/HttpError');

const WRITE_ROLES = new Set(['super_admin']);

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

function format(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    version: row.version,
    profile: row.profile,
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

  const profile = {
    schema_version: 1,
    repo_url: repo.repoUrl.replace(/\.git$/, ''),
    base_branch: repo.defaultBranch || 'main',
    languages: [...new Set(languages)],
    setup: [...new Set(setup)],
    verify: [...new Set(verify)],
    caches: [],
    env: {},
    timeouts: { setup_minutes: 15, verify_minutes: 20 },
    max_round_minutes: 45,
    services: [],
    flaky_tests: [],
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

class RepoProfileService {
  async listVersions(projectId, user) {
    await assertCanRead(projectId, user);
    const result = await pool.query(
      `SELECT * FROM repo_profiles
       WHERE project_id = $1
       ORDER BY version DESC`,
      [projectId]
    );
    return result.rows.map(format);
  }

  async getCurrent(projectId, user) {
    await assertCanRead(projectId, user);
    const result = await pool.query(
      `SELECT * FROM repo_profiles
       WHERE project_id = $1
       ORDER BY (status = 'active') DESC, version DESC`,
      [projectId]
    );
    const rows = result.rows.map(format);
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
    return result.rows.length > 0 ? format(result.rows[0]) : null;
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
      return format(inserted.rows[0]);
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
    return format(updated.rows[0]);
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
        return format({ ...target.rows[0], profile_hash: contentHash });
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
      return format(activated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
module.exports.assertAgentProjectAccess = assertAgentProjectAccess;
module.exports.assertProjectExists = assertProjectExists;
module.exports.format = format;
module.exports.detectStack = detectStack;
module.exports.assertProfileRepoBinding = assertProfileRepoBinding;
module.exports.profileHash = profileHash;
