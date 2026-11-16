const HarnessRunService = require('./HarnessRunService');
const HarnessMetrics = require('./HarnessMetrics');
const HarnessEventService = require('./HarnessEventService');
const HarnessUsageService = require('./HarnessUsageService');
const logger = require('../utils/logger');

const DEFAULT_RECONCILE_LIMIT = 50;

/**
 * Scheduled reaper for durable harness runs (fg-33 slice 2).
 *
 * Reaping a lease and reconciling the ticket are separate statements. If the
 * process dies in between, the run is terminal with no lease, so the next sweep
 * would never see it. Every sweep therefore does both:
 *   1. expire stale leases / orphaned runs;
 *   2. reconcile the affected runs and any other terminal run whose
 *      `reconciled_at` marker is still unset.
 *
 * Reconciliation itself is guarded: a run with a stored PR URL is adopted into
 * the ticket, and only a failed run with no PR, an in-progress ticket, no
 * ticket PR and no newer active run may be returned to backlog.
 */
class HarnessReaper {
  async runOnce({ limit, orphanAfterSeconds } = {}) {    let reaped;
    try {
      reaped = await HarnessRunService.reapExpiredLeases(limit, orphanAfterSeconds);
    } catch (error) {
      HarnessMetrics.recordSweepFailure();
      throw error;
    }
    const summary = {
      reaped: reaped.length,
      released: 0,
      adopted: 0,
      reconciled: 0,
      needsOperator: 0,
      skipped: [],
    };

    let complete = true;
    const seen = new Set();
    const reconcile = async (runId, ticketId) => {
      if (!runId || seen.has(runId)) {
        return;
      }
      seen.add(runId);

      try {
        const result = await HarnessRunService.reconcileRun(runId);
        if (!result) {
          summary.skipped.push({ ticketId, runId, reason: 'run_not_terminal' });
          return;
        }
        if (result.released) summary.released += 1;
        if (result.adopted) summary.adopted += 1;
        if (result.marked) summary.reconciled += 1;
        if (result.needs_operator) summary.needsOperator += 1;
        await finalizeRunArtifacts(runId);
      } catch (error) {
        complete = false;
        summary.skipped.push({ ticketId, runId, reason: 'reconcile_failed' });
        logger.error(`Harness reaper reconcile failed for run ${runId}: ${error.message}`);
      }
    };

    for (const row of reaped) {
      await reconcile(row.run_id, row.ticket_id);
    }

    let pending = [];
    try {
      pending = await HarnessRunService.listTerminalRunsForReconcile(
        limit === undefined ? DEFAULT_RECONCILE_LIMIT : limit
      );
    } catch (error) {
      complete = false;
      logger.error(`Harness reaper could not list pending terminal runs: ${error.message}`);
    }
    for (const runId of pending) {
      await reconcile(runId, null);
    }

    HarnessMetrics.recordSweep(summary, { complete });

    if (summary.reaped > 0 || summary.reconciled > 0) {
      logger.info(
        `Harness reaper: reaped=${summary.reaped} reconciled=${summary.reconciled}`
          + ` released=${summary.released} adopted=${summary.adopted}`
          + ` needsOperator=${summary.needsOperator}`
          + ` skipped=${summary.skipped.length}`
      );
    }
    return summary;
  }
}

async function finalizeRunArtifacts(runId) {
  try {
    const run = await HarnessRunService.getRun(runId);
    await HarnessEventService.ensureTerminalEvent({
      runId,
      status: run.status,
      error: run.error,
      headSha: run.head_sha,
      prUrl: run.pr_url,
    });
    await HarnessUsageService.flushRunToUsageLogs(runId);
  } catch (error) {
    // Reconciliation stays durable even if observability/billing backfill
    // fails; the next sweep retries the terminal run until it is marked.
    logger.warn(`Could not finalize harness run ${runId}: ${error.message}`);
  }
}

const instance = new HarnessReaper();
module.exports = instance;
module.exports.HarnessReaper = HarnessReaper;
module.exports.DEFAULT_RECONCILE_LIMIT = DEFAULT_RECONCILE_LIMIT;
