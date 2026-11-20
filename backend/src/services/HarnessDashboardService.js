const { pool } = require('../db');
const HarnessUsageService = require('./HarnessUsageService');
const HarnessBudgetService = require('./HarnessBudgetService');
const HarnessRunService = require('./HarnessRunService');
const HarnessMetrics = require('./HarnessMetrics');
const { ValidationError } = require('../errors/HttpError');

/**
 * Harness dashboards and alerts (fg-41 slice 2, fg-38 FR5/FR7).
 *
 * A deliberately cheap, read-only SQL aggregate. Unmeasurable values are
 * returned as null (never a fabricated zero) so the UI can distinguish "no
 * data" from "zero". Merge/rollback metrics stay null until fg-36 records them.
 */

const DEFAULT_PERIOD_DAYS = 7;
const DEFAULT_STUCK_MINUTES = 15;
const DEFAULT_REPEATED_FAILURES = 3;
const DEFAULT_DIFF_ALERT_BYTES = 1_000_000;
const DEFAULT_FAILURE_RATE_WINDOW_MINUTES = 60;

function envInt(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function parseDate(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${field} must be a timestamp`);
  }
  return date;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

class HarnessDashboardService {
  async getDashboard(projectId, { since, until } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const untilDate = parseDate(until, new Date(), 'until');
    const sinceDate = parseDate(
      since,
      new Date(untilDate.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000),
      'since'
    );
    if (sinceDate > untilDate) {
      throw new ValidationError('since must be before until');
    }

    const stuckMinutes = envInt('HARNESS_STUCK_MINUTES', DEFAULT_STUCK_MINUTES);
    const diffAlertBytes = envInt('HARNESS_DIFF_ALERT_BYTES', DEFAULT_DIFF_ALERT_BYTES);
    const repeatedFailures = envInt('HARNESS_REPEATED_FAILURES', DEFAULT_REPEATED_FAILURES);
    const failureWindowMinutes = envInt(
      'HARNESS_FAILURE_RATE_WINDOW_MINUTES', DEFAULT_FAILURE_RATE_WINDOW_MINUTES);

    const [runs, throughput, usage, stuck, eventCounts, toolFailures,
      secretFlagged, repeated, largeDiffs, policy, recentRuns] = await Promise.all([
      this.getRunAggregate(id, sinceDate, untilDate),
      this.getThroughput(id, sinceDate, untilDate),
      HarnessUsageService.summarizeProject(id, {
        since: sinceDate,
        until: untilDate,
      }),
      this.getStuckRuns(id, stuckMinutes),
      this.getEventCounts(id, sinceDate, untilDate),
      this.getToolFailures(id, sinceDate, untilDate),
      this.getSecretFlagged(id, sinceDate, untilDate),
      this.getRepeatedFailures(id, sinceDate, untilDate, repeatedFailures),
      this.getLargeDiffs(id, sinceDate, untilDate, diffAlertBytes),
      HarnessBudgetService.getPolicy(id),
      HarnessRunService.listRunsForProject(id, {
        since: sinceDate,
        until: untilDate,
        limit: 50,
      }),
    ]);

    const failureWindow = await this.getFailureWindow(id, failureWindowMinutes);
    const alerts = this.buildAlerts({
      stuck,
      stuckMinutes,
      runs,
      failureWindow,
      repeated,
      policy,
      secretFlagged,
      largeDiffs,
      diffAlertBytes,
    });

    HarnessMetrics.setStuckRuns(stuck.length);

    return {
      projectId: id,
      period: { since: sinceDate.toISOString(), until: untilDate.toISOString() },
      runs,
      recentRuns,
      throughput,
      cost: usage,
      stuckRuns: stuck,
      review: {
        reviewRounds: eventCounts['review.result'] || 0,
        fixRounds: eventCounts['fix.requested'] || 0,
      },
      toolCalls: {
        total: usage.totals.toolCalls,
        failed: toolFailures,
      },
      secretScan: {
        flaggedEvents: secretFlagged,
      },
      budget: {
        dailySpendUsd: policy.dailySpendUsd,
        dailyLimitUsd: policy.quotas.dailyCostUsd,
        killSwitch: policy.killSwitch,
        routing: policy.routing,
        limits: policy.limits,
      },
      merge: null,
      rollback: null,
      alerts,
    };
  }

  async getRunAggregate(projectId, since, until) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE r.status = 'succeeded')::int AS succeeded,
              COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE r.status = 'dead_letter')::int AS dead_letter,
              COUNT(*) FILTER (WHERE r.status = 'budget_exceeded')::int AS budget_exceeded,
              COUNT(*) FILTER (WHERE r.status = 'running')::int AS running,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (r.finished_at - r.started_at))
              ) FILTER (WHERE r.finished_at IS NOT NULL) AS p50_duration_seconds,
              percentile_cont(0.95) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (r.finished_at - r.started_at))
              ) FILTER (WHERE r.finished_at IS NOT NULL) AS p95_duration_seconds
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE COALESCE(r.project_id, t.project_id) = $1
         AND r.started_at >= $2 AND r.started_at <= $3`,
      [projectId, since.toISOString(), until.toISOString()]
    );
    const row = result.rows?.[0] || {};
    const total = Number(row.total || 0);
    const succeeded = Number(row.succeeded || 0);
    const terminal = total - Number(row.running || 0);
    return {
      total,
      succeeded,
      failed: Number(row.failed || 0),
      deadLetter: Number(row.dead_letter || 0),
      budgetExceeded: Number(row.budget_exceeded || 0),
      running: Number(row.running || 0),
      successRate: terminal > 0 ? succeeded / terminal : null,
      durationSeconds: {
        p50: numberOrNull(row.p50_duration_seconds),
        p95: numberOrNull(row.p95_duration_seconds),
      },
    };
  }

  async getThroughput(projectId, since, until) {
    const result = await pool.query(
      `SELECT date_trunc('day', r.started_at) AS day,
              COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE r.status = 'succeeded')::int AS succeeded,
              COUNT(*) FILTER (WHERE r.status IN ('failed', 'dead_letter'))::int AS failed,
              COUNT(*) FILTER (WHERE r.status = 'budget_exceeded')::int AS budget_exceeded
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE COALESCE(r.project_id, t.project_id) = $1
         AND r.started_at >= $2 AND r.started_at <= $3
       GROUP BY 1
       ORDER BY 1 ASC`,
      [projectId, since.toISOString(), until.toISOString()]
    );
    return (result.rows || []).map((row) => ({
      day: row.day instanceof Date ? row.day.toISOString() : row.day,
      runs: Number(row.runs || 0),
      succeeded: Number(row.succeeded || 0),
      failed: Number(row.failed || 0),
      budgetExceeded: Number(row.budget_exceeded || 0),
    }));
  }

  async getStuckRuns(projectId, stuckMinutes) {
    const result = await pool.query(
      `SELECT r.id, r.ticket_id, r.agent_id, r.runtime_id, r.step, r.agent_step,
              r.started_at, r.heartbeat_at,
              EXTRACT(EPOCH FROM (NOW() - r.heartbeat_at))::int AS stale_seconds
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE COALESCE(r.project_id, t.project_id) = $1
         AND r.status = 'running'
         AND r.heartbeat_at < NOW() - ($2::int * INTERVAL '1 minute')
       ORDER BY r.heartbeat_at ASC
       LIMIT 50`,
      [projectId, stuckMinutes]
    );
    return result.rows || [];
  }

  async getEventCounts(projectId, since, until) {
    // Alert/dashboard windows use the later of event time and server receipt so
    // a backdated or delayed event cannot be hidden from the current window.
    const result = await pool.query(
      `SELECT type, COUNT(*)::int AS count
       FROM harness_events
       WHERE project_id = $1
         AND type IN ('review.result', 'fix.requested', 'budget.warning',
                      'budget.breach', 'tool.called')
         AND GREATEST(event_timestamp, created_at) >= $2
         AND GREATEST(event_timestamp, created_at) <= $3
       GROUP BY type`,
      [projectId, since.toISOString(), until.toISOString()]
    );
    const counts = {};
    for (const row of result.rows || []) {
      counts[row.type] = Number(row.count || 0);
    }
    return counts;
  }

  async getToolFailures(projectId, since, until) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM harness_events
       WHERE project_id = $1
         AND type = 'tool.called'
         AND (payload->>'failed' = 'true' OR payload->>'failed' = '1')
         AND GREATEST(event_timestamp, created_at) >= $2
         AND GREATEST(event_timestamp, created_at) <= $3`,
      [projectId, since.toISOString(), until.toISOString()]
    );
    return Number(result.rows?.[0]?.count || 0);
  }

  async getSecretFlagged(projectId, since, until) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM harness_events
       WHERE project_id = $1
         AND payload->'_redaction'->>'secret_flagged' = 'true'
         AND GREATEST(event_timestamp, created_at) >= $2
         AND GREATEST(event_timestamp, created_at) <= $3`,
      [projectId, since.toISOString(), until.toISOString()]
    );
    return Number(result.rows?.[0]?.count || 0);
  }

  async getRepeatedFailures(projectId, since, until, threshold) {
    const result = await pool.query(
      `SELECT r.ticket_id, COUNT(*)::int AS failures
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE COALESCE(r.project_id, t.project_id) = $1
         AND r.status IN ('failed', 'dead_letter')
         AND r.started_at >= $2 AND r.started_at <= $3
       GROUP BY r.ticket_id
       HAVING COUNT(*) >= $4
       ORDER BY failures DESC
       LIMIT 20`,
      [projectId, since.toISOString(), until.toISOString(), threshold]
    );
    return result.rows || [];
  }

  async getLargeDiffs(projectId, since, until, threshold) {
    const result = await pool.query(
      `SELECT event_id, run_id, ticket_id, payload, event_timestamp
       FROM harness_events
       WHERE project_id = $1
         AND type = 'diff.collected'
         AND GREATEST(event_timestamp, created_at) >= $2
         AND GREATEST(event_timestamp, created_at) <= $3
         AND CASE WHEN payload->>'changedBytes' ~ '^[0-9]+$'
                  THEN (payload->>'changedBytes')::bigint ELSE 0 END > $4
       ORDER BY GREATEST(event_timestamp, created_at) DESC
       LIMIT 20`,
      [projectId, since.toISOString(), until.toISOString(), threshold]
    );
    return result.rows || [];
  }

  async getFailureWindow(projectId, windowMinutes) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE r.status IN ('failed', 'dead_letter'))::int AS failed
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE COALESCE(r.project_id, t.project_id) = $1
         AND r.started_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
      [projectId, windowMinutes]
    );
    const row = result.rows?.[0] || {};
    const total = Number(row.total || 0);
    const failed = Number(row.failed || 0);
    return {
      windowMinutes,
      total,
      failed,
      failureRate: total > 0 ? failed / total : null,
    };
  }

  buildAlerts({
    stuck,
    stuckMinutes,
    runs,
    failureWindow,
    repeated,
    policy,
    secretFlagged,
    largeDiffs,
    diffAlertBytes,
  }) {
    const alerts = [];
    if (stuck.length > 0) {
      alerts.push({
        code: 'stuck_run',
        severity: 'warning',
        message: `${stuck.length} harness run(s) have not sent a heartbeat for ${stuckMinutes} minutes`,
        runIds: stuck.map((row) => row.id),
      });
    }
    if (failureWindow.total >= 5 && failureWindow.failureRate !== null
      && failureWindow.failureRate >= 0.5) {
      alerts.push({
        code: 'failure_rate_spike',
        severity: 'warning',
        message: `Harness failure rate is ${Math.round(failureWindow.failureRate * 100)}% `
          + `over the last ${failureWindow.windowMinutes} minutes`,
        value: failureWindow.failureRate,
        threshold: 0.5,
      });
    }
    if (repeated.length > 0) {
      alerts.push({
        code: 'repeated_failure',
        severity: 'warning',
        message: `${repeated.length} ticket(s) failed repeatedly`,
        tickets: repeated,
      });
    }
    if (runs.budgetExceeded > 0) {
      alerts.push({
        code: 'budget_exceeded',
        severity: 'warning',
        message: `${runs.budgetExceeded} harness run(s) stopped at a hard budget limit`,
        value: runs.budgetExceeded,
      });
    }
    if (policy.quotas.dailyCostUsd > 0
      && policy.dailySpendUsd >= policy.quotas.dailyCostUsd) {
      alerts.push({
        code: 'daily_budget_exhausted',
        severity: 'critical',
        message: `Harness daily spend ${policy.dailySpendUsd.toFixed(2)} USD reached the `
          + `${policy.quotas.dailyCostUsd.toFixed(2)} USD project limit`,
        value: policy.dailySpendUsd,
        threshold: policy.quotas.dailyCostUsd,
      });
    }
    if (secretFlagged > 0) {
      alerts.push({
        code: 'secret_pattern',
        severity: 'critical',
        message: `${secretFlagged} harness event(s) contained a redacted credential pattern`,
        value: secretFlagged,
      });
    }
    if (largeDiffs.length > 0) {
      alerts.push({
        code: 'abnormal_diff_size',
        severity: 'warning',
        message: `${largeDiffs.length} diff(s) exceeded ${diffAlertBytes} bytes`,
        value: largeDiffs.length,
        threshold: diffAlertBytes,
        runIds: largeDiffs.map((row) => row.run_id).filter(Boolean),
      });
    }
    return alerts;
  }
}

const instance = new HarnessDashboardService();
module.exports = instance;
module.exports.HarnessDashboardService = HarnessDashboardService;
module.exports.DEFAULT_PERIOD_DAYS = DEFAULT_PERIOD_DAYS;
