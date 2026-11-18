const fs = require('fs');
const path = require('path');

const migrations = path.join(__dirname, '..', 'migrations');
const applySource = fs.readFileSync(path.join(migrations, 'apply.js'), 'utf8');
const sql = fs.readFileSync(path.join(migrations, '055_agent_enrollment.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(migrations, '055_agent_enrollment_rollback.sql'), 'utf8');

describe('agent enrollment migration (FR3, NFR5)', () => {
  it('registers the additive migration after the agent-revoke permission', () => {
    const revoke = applySource.indexOf("054_agent_revoke_project_admin.sql");
    const enrollment = applySource.indexOf('055_agent_enrollment.sql');
    expect(revoke).toBeGreaterThan(-1);
    expect(enrollment).toBeGreaterThan(revoke);
  });

  it('adds the project scope and replay-cache schema', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS project_id');
    expect(sql).toContain('idx_agents_project_id');
    expect(sql).toContain('family_id UUID NOT NULL');
    expect(sql).toContain('agent_refresh_replays');
    expect(sql).toContain('UNIQUE (refresh_token_id, idempotency_key)');
  });

  it('drops dependent tables child-first on rollback', () => {
    const agentsColumn = rollback.indexOf('project_id');
    const events = rollback.indexOf('DROP TABLE IF EXISTS agent_auth_events');
    const replays = rollback.indexOf('DROP TABLE IF EXISTS agent_refresh_replays');
    const refresh = rollback.indexOf('DROP TABLE IF EXISTS agent_refresh_tokens');
    const enrollment = rollback.indexOf('DROP TABLE IF EXISTS agent_enrollment_tokens');

    expect(agentsColumn).toBeGreaterThan(-1);
    expect(events).toBeGreaterThan(agentsColumn);
    expect(replays).toBeGreaterThan(events);
    expect(refresh).toBeGreaterThan(replays);
    expect(enrollment).toBeGreaterThan(refresh);
  });
});
