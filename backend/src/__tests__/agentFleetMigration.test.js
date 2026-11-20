const fs = require('fs');
const path = require('path');

const migrations = path.join(__dirname, '..', 'migrations');
const applySource = fs.readFileSync(path.join(migrations, 'apply.js'), 'utf8');
const sql = fs.readFileSync(path.join(migrations, '056_agent_fleet.sql'), 'utf8');
const rollback = fs.readFileSync(
  path.join(migrations, '056_agent_fleet_rollback.sql'),
  'utf8'
);

describe('agent fleet migration (FR1, FR2, FR16, NFR5)', () => {
  it('registers 056 after the enrollment migration', () => {
    const enrollment = applySource.indexOf('055_agent_enrollment.sql');
    const fleet = applySource.indexOf('056_agent_fleet.sql');
    expect(enrollment).toBeGreaterThan(-1);
    expect(fleet).toBeGreaterThan(enrollment);
  });

  it('creates the node, grant, runtime and registry schema', () => {
    for (const table of [
      'agent_nodes',
      'agent_node_grants',
      'agent_runtimes',
      'provider_credentials',
      'provider_models',
      'agent_node_enrollment_tokens',
      'agent_node_access_tokens',
      'agent_node_refresh_tokens',
      'agent_node_auth_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('uses a partial unique index for active grants', () => {
    expect(sql).toContain('uq_agent_node_grants_active');
    expect(sql).toMatch(/WHERE revoked_at IS NULL/);
  });

  it('makes global credential names unique per owner', () => {
    expect(sql).toContain('UNIQUE NULLS NOT DISTINCT (owner_id, project_id, name)');
  });

  it('adds only runtime_id to the append-only event store', () => {
    expect(sql).toContain('ALTER TABLE harness_events ADD COLUMN IF NOT EXISTS runtime_id');
    expect(sql).not.toMatch(/UPDATE\s+harness_events/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+harness_events/i);
    expect(sql).not.toMatch(/ALTER TABLE harness_events RENAME/i);
    expect(sql).not.toMatch(/ALTER TABLE harness_events DROP/i);
  });

  it('detaches, resets and renames legacy runtime references', () => {
    expect(sql).toContain('agent_heartbeats DROP CONSTRAINT');
    expect(sql).toContain('UPDATE usage_logs SET agent_id = NULL');
    expect(sql).toContain('DELETE FROM harness_runs');
    expect(sql).toContain('ALTER TABLE tickets RENAME COLUMN assigned_agent_id TO assigned_runtime_id');
    expect(sql).toContain('UPDATE tickets SET assigned_runtime_id = NULL');
  });

  it('drops token tables before agents and providers', () => {
    const refresh = sql.indexOf('DROP TABLE IF EXISTS agent_refresh_tokens');
    const agents = sql.indexOf('DROP TABLE IF EXISTS agents;');
    const providers = sql.indexOf('DROP TABLE IF EXISTS providers;');
    expect(refresh).toBeGreaterThan(-1);
    expect(agents).toBeGreaterThan(refresh);
    expect(providers).toBeGreaterThan(agents);
  });

  it('drops new tables child-first on rollback and restores legacy identities', () => {
    const runtimes = rollback.indexOf('DROP TABLE IF EXISTS agent_runtimes');
    const grants = rollback.indexOf('DROP TABLE IF EXISTS agent_node_grants');
    const models = rollback.indexOf('DROP TABLE IF EXISTS provider_models');
    const credentials = rollback.indexOf('DROP TABLE IF EXISTS provider_credentials');
    const nodes = rollback.indexOf('DROP TABLE IF EXISTS agent_nodes');
    const agents = rollback.indexOf('CREATE TABLE IF NOT EXISTS agents');

    expect(runtimes).toBeGreaterThan(-1);
    expect(grants).toBeGreaterThan(runtimes);
    expect(models).toBeGreaterThan(grants);
    expect(credentials).toBeGreaterThan(models);
    expect(nodes).toBeGreaterThan(credentials);
    expect(agents).toBeGreaterThan(nodes);
    expect(rollback).toContain('ALTER TABLE tickets RENAME COLUMN assigned_runtime_id TO assigned_agent_id');
    expect(rollback).toContain('CREATE TRIGGER release_agent_tickets_on_delete');
  });
});
