const fs = require('fs');
const path = require('path');

const migrations = path.join(__dirname, '..', 'migrations');
const applySource = fs.readFileSync(path.join(migrations, 'apply.js'), 'utf8');
const sql = fs.readFileSync(path.join(migrations, '062_ticket_review_attempts.sql'), 'utf8');
const rollback = fs.readFileSync(
  path.join(migrations, '062_ticket_review_attempts_rollback.sql'),
  'utf8'
);

describe('review attempt migration (fg-31a FR7/FR8)', () => {
  it('registers the additive migration after readiness', () => {
    const readiness = applySource.indexOf('061_ticket_readiness.sql');
    const review = applySource.indexOf('062_ticket_review_attempts.sql');
    expect(readiness).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(readiness);
  });

  it('creates attempts and findings with the idempotency guards', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ticket_review_attempts');
    expect(sql).toContain("status IN ('started', 'completed', 'failed')");
    expect(sql).toContain("verdict IN ('approve', 'request_changes', 'comment')");
    expect(sql).toContain('uq_review_attempt_completed');
    expect(sql).toContain("WHERE status = 'completed'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ticket_review_findings');
    expect(sql).toContain('UNIQUE (attempt_id, finding_key)');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('drops findings before attempts on rollback', () => {
    const findings = rollback.indexOf('DROP TABLE IF EXISTS ticket_review_findings');
    const attempts = rollback.indexOf('DROP TABLE IF EXISTS ticket_review_attempts');
    expect(findings).toBeGreaterThan(-1);
    expect(attempts).toBeGreaterThan(findings);
  });
});
