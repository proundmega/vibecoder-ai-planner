const crypto = require('crypto');
const { pool } = require('../db');
const { redactPayload, redactText } = require('../utils/harnessRedaction');
const {
  ValidationError,
  ConflictError,
} = require('../errors/HttpError');

/**
 * Harness privacy and data-governance policy (fg-42).
 *
 * The policy is resolved before a run starts (provider allowlist, local-only,
 * residency, classification ceiling) and again when data is deleted/exported.
 * Queries fail closed: a policy read error aborts the provider check instead of
 * silently allowing an unclassified external call.
 */

const DATA_CLASSES = Object.freeze(['public', 'internal', 'confidential', 'secret']);
const CLASS_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  secret: 3,
});
const DATA_CLASS_SET = new Set(DATA_CLASSES);
const DELETE_CLASSES = Object.freeze([
  'events',
  'usage',
  'messages',
  'checkpoints',
  'runs',
  'usage_logs',
  'all',
]);
const DEFAULT_MAX_CLASS = 'confidential';

function envList(name) {
  const value = process.env[name];
  if (!value || !value.trim()) return [];
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function envInt(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normaliseProvider(provider) {
  return String(provider || '').trim().toLowerCase().replace(/_/g, '-');
}

function normaliseEndpoint(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || null;
}

function isLocalEndpoint(providerBaseUrl, localEndpoint) {
  const base = normaliseEndpoint(providerBaseUrl);
  const local = normaliseEndpoint(localEndpoint);
  if (!base || !local) return false;
  return base === local || base.startsWith(`${local}/`);
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function retentionDays(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new ValidationError(`${field} must be an integer between 1 and 3650`);
  }
  return parsed;
}

function defaults() {
  return {
    maxDataClass: DATA_CLASS_SET.has(process.env.HARNESS_DEFAULT_MAX_DATA_CLASS)
      ? process.env.HARNESS_DEFAULT_MAX_DATA_CLASS
      : DEFAULT_MAX_CLASS,
    allowedProviders: envList('HARNESS_DEFAULT_ALLOWED_PROVIDERS')
      .map(normaliseProvider),
    requireNoTraining: envBool('HARNESS_DEFAULT_REQUIRE_NO_TRAINING', false),
    localOnly: envBool('HARNESS_DEFAULT_LOCAL_ONLY', false),
    localEndpoint: normaliseEndpoint(process.env.HARNESS_DEFAULT_LOCAL_ENDPOINT),
    localModel: process.env.HARNESS_DEFAULT_LOCAL_MODEL || null,
    dataResidency: process.env.HARNESS_DEFAULT_DATA_RESIDENCY || null,
    blockOnSecret: envBool('HARNESS_DEFAULT_BLOCK_ON_SECRET', false),
    blockOnPii: envBool('HARNESS_DEFAULT_BLOCK_ON_PII', false),
    redactPii: envBool('HARNESS_DEFAULT_REDACT_PII', true),
    eventRetentionDays: envInt('HARNESS_DEFAULT_EVENT_RETENTION_DAYS', 30),
    artifactRetentionDays: envInt('HARNESS_DEFAULT_ARTIFACT_RETENTION_DAYS', 7),
  };
}

function rowToPolicy(row, source) {
  const base = defaults();
  if (!row) {
    return { projectId: null, source: 'default', policyVersion: 0, ...base, updatedAt: null };
  }
  return {
    projectId: Number(row.project_id),
    source,
    maxDataClass: DATA_CLASS_SET.has(row.max_data_class)
      ? row.max_data_class
      : base.maxDataClass,
    allowedProviders: Array.isArray(row.allowed_providers)
      ? row.allowed_providers.map(normaliseProvider)
      : base.allowedProviders,
    requireNoTraining: Boolean(row.require_no_training),
    localOnly: Boolean(row.local_only),
    localEndpoint: normaliseEndpoint(row.local_endpoint),
    localModel: row.local_model || null,
    dataResidency: row.data_residency || null,
    blockOnSecret: Boolean(row.block_on_secret),
    blockOnPii: Boolean(row.block_on_pii),
    redactPii: Boolean(row.redact_pii),
    eventRetentionDays: Number(row.event_retention_days),
    artifactRetentionDays: Number(row.artifact_retention_days),
    policyVersion: Number(row.policy_version),
    updatedAt: row.updated_at || null,
  };
}

function redactExportValue(value) {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactExportValue);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactExportValue(child)])
    );
  }
  return value;
}

function redactExportRow(row) {
  return row ? redactExportValue(row) : row;
}

function redactExportRows(rows) {
  return (rows || []).map(redactExportRow);
}

class HarnessPrivacyService {
  async getPolicy(projectId, { client = pool } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const result = await client.query(
      'SELECT * FROM harness_privacy_policies WHERE project_id = $1',
      [id]
    );
    return rowToPolicy(result.rows?.[0] || null, result.rows?.length ? 'project' : 'default');
  }

  /**
   * Enforce provider, residency, no-training and local-only policy before a
   * run is created. Any policy read error propagates (fail closed).
   */
  async assertProviderAllowed({
    projectId,
    provider,
    providerBaseUrl = null,
    providerRegion = null,
    agentId = null,
    client = pool,
  } = {}) {
    const policy = await this.getPolicy(projectId, { client });
    let resolvedBaseUrl = providerBaseUrl;
    let resolvedRegion = providerRegion;
    if (agentId !== null && agentId !== undefined) {
      // Prefer the provider config the backend owns over agent-supplied
      // metadata. The agent is trusted, but this is defense in depth and gives
      // the run an auditable endpoint/region.
      const providerConfig = await client.query(
        `SELECT p.base_url,
                p.routing_rules->>'region' AS region
         FROM agents a
         LEFT JOIN providers p ON p.id = a.provider_id
         WHERE a.id = $1`,
        [positiveInteger(agentId, 'agentId')]
      );
      const row = providerConfig.rows?.[0] || {};
      if (row.base_url) resolvedBaseUrl = row.base_url;
      if (row.region) resolvedRegion = row.region;
    }
    const normalised = normaliseProvider(provider);
    const restricted = policy.source === 'project'
      || policy.allowedProviders.length > 0
      || policy.requireNoTraining
      || policy.localOnly
      || Boolean(policy.dataResidency)
      || policy.maxDataClass === 'secret';
    if (!normalised) {
      if (!restricted) {
        return {
          ...policy,
          resolvedProviderBaseUrl: resolvedBaseUrl,
          resolvedProviderRegion: resolvedRegion,
        };
      }
      throw new ConflictError('Harness provider is required by privacy policy');
    }
    const local = isLocalEndpoint(resolvedBaseUrl, policy.localEndpoint);
    if (policy.allowedProviders.length > 0
      && !policy.allowedProviders.includes(normalised)
      && !local) {
      throw new ConflictError(
        `Provider '${normalised}' is not allowed by the project privacy policy`
      );
    }
    if (policy.localOnly && !local) {
      throw new ConflictError(
        'Project privacy policy requires a local/self-hosted model endpoint'
      );
    }
    if (policy.maxDataClass === 'secret' && !local) {
      throw new ConflictError(
        'Secret-class data requires a local/self-hosted model endpoint'
      );
    }
    if (policy.requireNoTraining && !local) {
      const attested = envList('HARNESS_NO_TRAINING_PROVIDERS').map(normaliseProvider);
      if (!attested.includes(normalised)) {
        throw new ConflictError(
          `Provider '${normalised}' has no no-training attestation for this project`
        );
      }
    }
    if (policy.dataResidency
      && (!resolvedRegion
        || String(resolvedRegion).toLowerCase() !== policy.dataResidency.toLowerCase())) {
      throw new ConflictError(
        `Provider region '${resolvedRegion || 'unspecified'}' does not satisfy `
          + `project residency '${policy.dataResidency}'`
      );
    }
    return {
      ...policy,
      resolvedProviderBaseUrl: resolvedBaseUrl,
      resolvedProviderRegion: resolvedRegion,
    };
  }

  async upsertPolicy({ projectId, policy = {}, updatedBy = null, client = pool } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const maxDataClass = policy.maxDataClass === undefined
      ? null
      : String(policy.maxDataClass);
    if (maxDataClass !== null && !DATA_CLASS_SET.has(maxDataClass)) {
      throw new ValidationError(
        `maxDataClass must be one of: ${DATA_CLASSES.join(', ')}`
      );
    }
    const allowedProviders = policy.allowedProviders === undefined
      ? null
      : (Array.isArray(policy.allowedProviders)
        ? policy.allowedProviders
        : String(policy.allowedProviders).split(','))
        .map(normaliseProvider)
        .filter(Boolean);
    const localEndpoint = policy.localEndpoint === undefined
      ? null
      : normaliseEndpoint(policy.localEndpoint);
    if (localEndpoint) {
      let parsed;
      try {
        parsed = new URL(localEndpoint);
      } catch {
        throw new ValidationError('localEndpoint must be a valid URL');
      }
      if (parsed.username || parsed.password) {
        throw new ValidationError('localEndpoint must not contain credentials');
      }
    }
    const clearLocalEndpoint = policy.localEndpoint === null || policy.localEndpoint === '';
    const clearLocalModel = policy.localModel === null || policy.localModel === '';
    const clearDataResidency = policy.dataResidency === null
      || policy.dataResidency === '';

    const result = await client.query(
      `INSERT INTO harness_privacy_policies
         (project_id, max_data_class, allowed_providers, require_no_training,
          local_only, local_endpoint, local_model, data_residency, block_on_secret,
          block_on_pii, redact_pii, event_retention_days, artifact_retention_days,
          policy_version, updated_by, updated_at)
       VALUES ($1,
               COALESCE($2, 'confidential'),
               COALESCE($3::text[], '{}'),
               COALESCE($4, FALSE),
               COALESCE($5, FALSE),
               $6, $7, $8,
               COALESCE($9, FALSE),
               COALESCE($10, FALSE),
               COALESCE($11, TRUE),
               COALESCE($12, 30),
               COALESCE($13, 7),
               1, $14, NOW())
       ON CONFLICT (project_id) DO UPDATE
       SET max_data_class = COALESCE($2, harness_privacy_policies.max_data_class),
           allowed_providers = COALESCE($3::text[], harness_privacy_policies.allowed_providers),
           require_no_training = COALESCE($4, harness_privacy_policies.require_no_training),
           local_only = COALESCE($5, harness_privacy_policies.local_only),
           local_endpoint = CASE WHEN $15 THEN NULL
             ELSE COALESCE($6, harness_privacy_policies.local_endpoint) END,
           local_model = CASE WHEN $16 THEN NULL
             ELSE COALESCE($7, harness_privacy_policies.local_model) END,
           data_residency = CASE WHEN $17 THEN NULL
             ELSE COALESCE($8, harness_privacy_policies.data_residency) END,
           block_on_secret = COALESCE($9, harness_privacy_policies.block_on_secret),
           block_on_pii = COALESCE($10, harness_privacy_policies.block_on_pii),
           redact_pii = COALESCE($11, harness_privacy_policies.redact_pii),
           event_retention_days = COALESCE($12, harness_privacy_policies.event_retention_days),
           artifact_retention_days = COALESCE(
             $13, harness_privacy_policies.artifact_retention_days),
           policy_version = harness_privacy_policies.policy_version + 1,
           updated_by = COALESCE($14, harness_privacy_policies.updated_by),
           updated_at = NOW()
       RETURNING *`,
      [
        id,
        maxDataClass,
        allowedProviders,
        policy.requireNoTraining === undefined ? null : Boolean(policy.requireNoTraining),
        policy.localOnly === undefined ? null : Boolean(policy.localOnly),
        localEndpoint,
        policy.localModel === undefined ? null : (policy.localModel || null),
        policy.dataResidency === undefined ? null : (policy.dataResidency || null),
        policy.blockOnSecret === undefined ? null : Boolean(policy.blockOnSecret),
        policy.blockOnPii === undefined ? null : Boolean(policy.blockOnPii),
        policy.redactPii === undefined ? null : Boolean(policy.redactPii),
        retentionDays(policy.eventRetentionDays, 'eventRetentionDays', null),
        retentionDays(policy.artifactRetentionDays, 'artifactRetentionDays', null),
        updatedBy,
        clearLocalEndpoint,
        clearLocalModel,
        clearDataResidency,
      ]
    );
    return rowToPolicy(result.rows[0], 'project');
  }

  async recordPolicyAudit({ projectId, policy, actorId = null, client = pool } = {}) {
    await client.query(
      `INSERT INTO harness_events
         (event_id, trace_id, project_id, type, payload)
       VALUES ($1, $2, $3, 'audit.privacy', $4::jsonb)`,
      [
        crypto.randomUUID(),
        crypto.randomUUID(),
        positiveInteger(projectId, 'projectId'),
        JSON.stringify(redactPayload({
          action: 'policy_updated',
          policyVersion: policy.policyVersion,
          maxDataClass: policy.maxDataClass,
          allowedProviders: policy.allowedProviders,
          requireNoTraining: policy.requireNoTraining,
          localOnly: policy.localOnly,
          localEndpoint: policy.localEndpoint,
          localModel: policy.localModel,
          dataResidency: policy.dataResidency,
          blockOnSecret: policy.blockOnSecret,
          blockOnPii: policy.blockOnPii,
          redactPii: policy.redactPii,
          eventRetentionDays: policy.eventRetentionDays,
          artifactRetentionDays: policy.artifactRetentionDays,
          actor: { type: 'user', id: actorId === null ? null : String(actorId) },
        }).payload),
      ]
    );
    return policy;
  }

  /**
   * Delete project-scoped run data. Audit tombstones are preserved and record
   * only counts, the requested classes, actor and reason.
   */
  async deleteProjectData({
    projectId,
    dataClasses = ['events'],
    before = null,
    reason = null,
    actorType = 'user',
    actorId = null,
  } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    if (!Array.isArray(dataClasses) || dataClasses.length === 0) {
      throw new ValidationError('dataClasses must be a non-empty array');
    }
    for (const dataClass of dataClasses) {
      if (!DELETE_CLASSES.includes(dataClass)) {
        throw new ValidationError(`unsupported data class: ${dataClass}`);
      }
    }
    let beforeDate = null;
    if (before !== null && before !== undefined && before !== '') {
      beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new ValidationError('before must be a valid timestamp');
      }
    }
    const classes = new Set(dataClasses);
    const all = classes.has('all');
    const deleteEvents = all || classes.has('events');
    const deleteUsage = all || classes.has('usage');
    const deleteMessages = all || classes.has('messages');
    const deleteCheckpoints = all || classes.has('checkpoints');
    const deleteRuns = all || classes.has('runs');
    const deleteUsageLogs = all || classes.has('usage_logs');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL harness.allow_event_purge = 'on'");
      const counts = {
        events: 0,
        usage: 0,
        messages: 0,
        checkpoints: 0,
        runs: 0,
        usageLogs: 0,
      };

      if (deleteMessages) {
        const params = [id];
        const predicate = beforeDate ? 'AND tm.created_at < $2' : '';
        if (beforeDate) params.push(beforeDate.toISOString());
        const result = await client.query(
          `DELETE FROM ticket_messages tm
           USING tickets t
           WHERE tm.ticket_id = t.id
             AND t.project_id = $1
             ${predicate}`,
          params
        );
        counts.messages = result.rowCount || 0;
      }

      if (deleteUsageLogs) {
        const params = [id];
        const predicate = beforeDate ? 'AND created_at < $2' : '';
        if (beforeDate) params.push(beforeDate.toISOString());
        const result = await client.query(
          `DELETE FROM usage_logs
           WHERE project_id = $1 ${predicate}`,
          params
        );
        counts.usageLogs = result.rowCount || 0;
      }

      if (deleteCheckpoints) {
        const params = [id];
        const predicate = beforeDate ? 'AND hc.created_at < $2' : '';
        if (beforeDate) params.push(beforeDate.toISOString());
        const result = await client.query(
          `DELETE FROM harness_checkpoints hc
           USING harness_runs r
           WHERE hc.run_id = r.id
             AND r.project_id = $1
             ${predicate}`,
          params
        );
        counts.checkpoints = result.rowCount || 0;
      }

      if (deleteEvents) {
        const params = [id];
        const predicate = beforeDate ? 'AND created_at < $2' : '';
        if (beforeDate) params.push(beforeDate.toISOString());
        const result = await client.query(
          `DELETE FROM harness_events
           WHERE project_id = $1
             AND type NOT LIKE 'audit.%'
             ${predicate}`,
          params
        );
        counts.events = result.rowCount || 0;
      }

      if (deleteUsage) {
        const params = [id];
        const predicate = beforeDate ? 'AND created_at < $2' : '';
        if (beforeDate) params.push(beforeDate.toISOString());
        const result = await client.query(
          `DELETE FROM harness_usage
           WHERE project_id = $1 ${predicate}`,
          params
        );
        counts.usage = result.rowCount || 0;
      }

      if (deleteRuns) {
        const params = [id];
        const predicate = beforeDate ? 'AND started_at < $2' : '';
        if (beforeDate) params.push(beforeDate.toISOString());
        const result = await client.query(
          `DELETE FROM harness_runs
           WHERE project_id = $1 ${predicate}`,
          params
        );
        counts.runs = result.rowCount || 0;
      }

      await client.query(
        `INSERT INTO harness_events
           (event_id, trace_id, project_id, type, payload)
         VALUES ($1, $2, $3, 'audit.privacy', $4::jsonb)`,
        [
          crypto.randomUUID(),
          crypto.randomUUID(),
          id,
          JSON.stringify(redactPayload({
            action: 'delete',
            dataClasses: Array.from(classes),
            before: beforeDate ? beforeDate.toISOString() : null,
            deleted: counts,
            reason: reason || null,
            actor: { type: actorType, id: actorId === null ? null : String(actorId) },
          }).payload),
        ]
      );
      await client.query('COMMIT');
      return counts;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async exportProjectData(projectId, { limit = 1000, offset = 0 } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 5000) {
      throw new ValidationError('limit must be an integer between 1 and 5000');
    }
    const parsedOffset = Number(offset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const fetchLimit = parsedLimit + 1;
      // Queries are sequential: one pg client must not execute concurrent
      // queries, and the repeatable-read snapshot keeps pages consistent.
      const policy = await this.getPolicy(id, { client });
      const events = await client.query(
        `SELECT * FROM harness_events WHERE project_id = $1
         ORDER BY event_timestamp ASC, event_id ASC LIMIT $2 OFFSET $3`,
        [id, fetchLimit, parsedOffset]
      );
      const usage = await client.query(
        `SELECT * FROM harness_usage WHERE project_id = $1
         ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [id, fetchLimit, parsedOffset]
      );
      const runs = await client.query(
        `SELECT * FROM harness_runs WHERE project_id = $1
         ORDER BY started_at ASC LIMIT $2 OFFSET $3`,
        [id, fetchLimit, parsedOffset]
      );
      const checkpoints = await client.query(
        `SELECT hc.* FROM harness_checkpoints hc
         JOIN harness_runs r ON r.id = hc.run_id
         WHERE r.project_id = $1
         ORDER BY hc.created_at ASC LIMIT $2 OFFSET $3`,
        [id, fetchLimit, parsedOffset]
      );
      const messages = await client.query(
        `SELECT tm.* FROM ticket_messages tm
         JOIN tickets t ON t.id = tm.ticket_id
         WHERE t.project_id = $1
         ORDER BY tm.created_at ASC LIMIT $2 OFFSET $3`,
        [id, fetchLimit, parsedOffset]
      );
      const usageLogs = await client.query(
        `SELECT * FROM usage_logs WHERE project_id = $1
         ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [id, fetchLimit, parsedOffset]
      );
      await client.query('COMMIT');
      const results = [events, usage, runs, checkpoints, messages, usageLogs];
      const trim = (result) => redactExportRows(result.rows.slice(0, parsedLimit));
      const hasMore = results.some((result) => result.rows.length > parsedLimit);
      return {
        projectId: id,
        exportedAt: new Date().toISOString(),
        policy: redactExportRow(policy),
        events: trim(events),
        usage: trim(usage),
        runs: trim(runs),
        checkpoints: trim(checkpoints),
        messages: trim(messages),
        usageLogs: trim(usageLogs),
        hasMore,
        nextOffset: hasMore ? parsedOffset + parsedLimit : null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  rank(dataClass) {
    return CLASS_RANK[dataClass] ?? CLASS_RANK.secret;
  }
}

const instance = new HarnessPrivacyService();
module.exports = instance;
module.exports.HarnessPrivacyService = HarnessPrivacyService;
module.exports.DATA_CLASSES = DATA_CLASSES;
module.exports.CLASS_RANK = CLASS_RANK;
module.exports.DELETE_CLASSES = DELETE_CLASSES;
module.exports.normaliseProvider = normaliseProvider;
module.exports.defaults = defaults;
