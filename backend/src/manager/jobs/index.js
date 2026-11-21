'use strict';

/**
 * fg-54 manager housekeeping jobs.
 *
 * <p>Each job is a single SQL unit of work that is safe to run from several
 * replicas. The entrypoint serialises a job across replicas with a Postgres
 * advisory lock, and the statements themselves use {@code FOR UPDATE SKIP
 * LOCKED} or conditional updates so a retry cannot double-apply a side effect.</p>
 */

const staleClaimSweep = require('./staleClaimSweep');
const enrollmentTokenCleanup = require('./enrollmentTokenCleanup');
const heartbeatExpiry = require('./heartbeatExpiry');

const JOBS = [
  { name: 'stale_claim_sweep', run: staleClaimSweep },
  { name: 'enrollment_token_cleanup', run: enrollmentTokenCleanup },
  { name: 'heartbeat_expiry', run: heartbeatExpiry },
];

module.exports = {
  JOBS,
  staleClaimSweep,
  enrollmentTokenCleanup,
  heartbeatExpiry,
};
