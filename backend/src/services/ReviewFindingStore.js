const { transaction } = require('../db');
const { pool } = require('../db');
const { ValidationError } = require('../errors/HttpError');

/**
 * fg-31a: structured review findings.
 *
 * Findings are replaced atomically for an attempt on retry and consumed by
 * fg-32; this store never dispatches a fixer.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

function requiredText(value, field, max = 4096) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`);
  }
  return trimmed;
}

function optionalText(value, field, max = 4096) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`);
  }
  return trimmed;
}

function optionalLine(value) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError('line must be a positive integer');
  }
  return parsed;
}

function normaliseFinding(finding, index) {
  if (finding == null || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new ValidationError(`findings[${index}] must be an object`);
  }
  return {
    findingKey: requiredText(finding.findingKey, `findings[${index}].findingKey`, 255),
    severity: requiredText(finding.severity, `findings[${index}].severity`, 64),
    file: optionalText(finding.file, `findings[${index}].file`, 1024),
    line: optionalLine(finding.line),
    message: requiredText(finding.message, `findings[${index}].message`),
    suggestion: optionalText(finding.suggestion, `findings[${index}].suggestion`),
  };
}

function normaliseFindings(findings) {
  if (findings == null) return [];
  if (!Array.isArray(findings)) {
    throw new ValidationError('findings must be an array');
  }
  return findings.map(normaliseFinding);
}

async function replaceForAttempt(attemptId, findings = []) {
  const id = uuid(attemptId, 'attemptId');
  const rowsToWrite = normaliseFindings(findings);

  return transaction(async (client) => {
    await client.query('DELETE FROM ticket_review_findings WHERE attempt_id = $1', [id]);
    const saved = [];
    for (const finding of rowsToWrite) {
      const { rows } = await client.query(
        `INSERT INTO ticket_review_findings
           (attempt_id, finding_key, severity, file, line, message, suggestion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          id,
          finding.findingKey,
          finding.severity,
          finding.file,
          finding.line,
          finding.message,
          finding.suggestion,
        ]
      );
      saved.push(rows[0]);
    }
    return saved;
  });
}

async function listForAttempt(attemptId) {
  const id = uuid(attemptId, 'attemptId');
  const { rows } = await pool.query(
    `SELECT * FROM ticket_review_findings
      WHERE attempt_id = $1
      ORDER BY severity, file NULLS LAST, line NULLS LAST, finding_key`,
    [id]
  );
  return rows;
}

module.exports = {
  replaceForAttempt,
  listForAttempt,
};
