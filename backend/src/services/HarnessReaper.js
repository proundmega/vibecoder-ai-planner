const HarnessRunService = require('./HarnessRunService');
const logger = require('../utils/logger');

/**
 * Scheduled reaper for durable harness runs (fg-33 slice 2).
 *
 * Expiring a lease is not enough: the ticket must also become runnable again.
 * Releasing it is guarded (see HarnessRunService.releaseTicketForRun) so a run
 * that actually published is never reset to backlog:
 *   - only a run this sweep failed (`run_failed=true`) can trigger release;
 *   - the ticket must still be `in_progress` with no `pr_url`;
 *   - no newer run may be active for the ticket.
 */
class HarnessReaper {
  async runOnce({ limit, orphanAfterSeconds } = {}) {
    const reaped = await HarnessRunService.reapExpiredLeases(limit, orphanAfterSeconds);
    const summary = {
      reaped: reaped.length,
      released: 0,
      skipped: [],
    };

    for (const row of reaped) {
      if (!row.run_failed) {
        summary.skipped.push({ ticketId: row.ticket_id, runId: row.run_id, reason: 'run_not_failed' });
        continue;
      }

      try {
        const released = await HarnessRunService.releaseTicketForRun(row.run_id);
        if (released) {
          summary.released += 1;
        } else {
          summary.skipped.push({
            ticketId: row.ticket_id,
            runId: row.run_id,
            reason: 'ticket_not_releasable',
          });
        }
      } catch (error) {
        summary.skipped.push({
          ticketId: row.ticket_id,
          runId: row.run_id,
          reason: 'release_failed',
        });
        logger.error(`Harness reaper release failed for ticket ${row.ticket_id}: ${error.message}`);
      }
    }

    if (summary.reaped > 0) {
      logger.info(
        `Harness reaper: reaped=${summary.reaped} released=${summary.released} skipped=${summary.skipped.length}`
      );
    }
    return summary;
  }
}

module.exports = new HarnessReaper();
module.exports.HarnessReaper = HarnessReaper;
