const GitProjectService = require('./GitProjectService');
const { ValidationError } = require('../errors/HttpError');

/**
 * fg-32b2: resolve the fix branch and reviewed SHA.
 *
 * The build path normally stores `tickets.branch_name`; older/agent-created
 * rows fall back to the provider's review-request head. The reviewed SHA comes
 * from the attempt/cache, with the same review head as a manual fallback. A
 * resolved branch that disagrees with the review head fails closed.
 */

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeSha(value) {
  const sha = text(value);
  if (!sha || !SHA_RE.test(sha)) {
    throw new ValidationError('No valid reviewed SHA is available for a fix request');
  }
  return sha.toLowerCase();
}

function roundValue(value) {
  const round = value == null ? 0 : Number(value);
  if (!Number.isInteger(round) || round < 0) {
    throw new ValidationError('review round must be a non-negative integer');
  }
  return round;
}

class FixBranchResolver {
  constructor(options = {}) {
    this.getReviewRequest = options.getReviewRequest
      || ((projectId, ticketId) => GitProjectService.getReviewRequest(projectId, ticketId));
  }

  async resolve(ticket, { reviewedSha = null, round = 0 } = {}) {
    if (!ticket) throw new ValidationError('Ticket is required');
    const projectId = ticket.projectId ?? ticket.project_id;
    const ticketId = ticket.id;
    const prUrl = ticket.prUrl ?? ticket.pr_url;
    let branch = text(ticket.branchName ?? ticket.branch_name
      ?? ticket.fixBranch ?? ticket.fix_branch);
    let sha = text(reviewedSha ?? ticket.reviewedSha ?? ticket.reviewed_sha);
    let review = null;

    if (prUrl && (!branch || !sha)) {
      review = await this.getReviewRequest(projectId, ticketId);
      if (!review) {
        throw new ValidationError('Could not resolve the review request head');
      }
      if (!branch) branch = text(review.branch);
      if (!sha) sha = text(review.headSha);
    }

    if (!branch) {
      throw new ValidationError(
        'Ticket branch is unavailable; cannot create a fix request');
    }
    if (branch.length > 255) {
      throw new ValidationError('Ticket branch exceeds 255 characters');
    }
    if (!sha) {
      throw new ValidationError('No reviewed SHA is available for a fix request');
    }
    if (review && review.branch && review.branch !== branch) {
      throw new ValidationError(
        'Resolved branch does not match the PR head branch');
    }
    return {
      branch,
      reviewedSha: normalizeSha(sha),
      round: roundValue(round),
    };
  }
}

module.exports = FixBranchResolver;
module.exports.FixBranchResolver = FixBranchResolver;
