const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(__dirname, '../migrations/050_repo_profiles.sql');
const ROLLBACK = path.join(__dirname, '../migrations/050_repo_profiles_rollback.sql');
const APPLY = path.join(__dirname, '../migrations/apply.js');

describe('repo profile migration (fg-39)', () => {
  it('registers the migration after 049', () => {
    const sql = fs.readFileSync(APPLY, 'utf8');
    const previous = sql.indexOf("049_project_github_installations.sql");
    const current = sql.indexOf("050_repo_profiles.sql");
    expect(previous).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(previous);
  });

  it('creates profiles, validations and harness-run profile columns', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS repo_profiles');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS repo_profile_validations');
    expect(sql).toContain('uq_repo_profiles_active');
    expect(sql).toContain('uq_repo_profile_validations_pending');
    expect(sql).toContain('profile_hash');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS profile_hash');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS repo_profile_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS repo_profile_version');
  });

  it('has a rollback that removes the columns before the tables', () => {
    const sql = fs.readFileSync(ROLLBACK, 'utf8');
    expect(sql.indexOf('DROP COLUMN IF EXISTS repo_profile_id'))
      .toBeLessThan(sql.indexOf('DROP TABLE IF EXISTS repo_profiles'));
    expect(sql).toContain('DROP TABLE IF EXISTS repo_profile_validations');
  });
});
