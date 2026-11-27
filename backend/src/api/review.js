const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { forTicketParam } = require('../middleware/agentProjectScope');
const { requireRuntime, requireTicketGrant } = require('../middleware/agentRole');
const {
  requireHumanStatusPermission,
  requireHumanProjectMembership,
} = require('../middleware/humanActor');
const { validatePathParams } = require('../middleware/validate');
const { pathParams } = require('../validators/pathParams');
const ReviewService = require('../services/ReviewService');
const FixDispatchService = require('../services/FixDispatchService');
const FixRequestService = require('../services/FixRequestService');

/**
 * Agents are authorized by runtime role/grant; humans need the same permission
 * as a normal status change. Kept local so one route can serve both callers.
 */
function requireAgentRuntime(req, res, next) {
  if (!req.agent) return next();
  if (!req.runtime || !req.runtime.id) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'RUNTIME_REQUIRED',
        message: 'A running reviewer runtime is required',
      },
    });
  }
  return next();
}

// fg-32a: the reviewer calls this after writing a completed request_changes
// attempt. The endpoint is idempotent per attempt id.
router.post(
  '/:ticketId/review/request-changes',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forTicketParam(),
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireTicketGrant('reviewer'),
  requireAgentRuntime,
  requireHumanStatusPermission,
  requireHumanProjectMembership,
  async (req, res, next) => {
    try {
      const attemptId = req.body?.attempt_id ?? req.body?.attemptId ?? null;
      if (req.agent && !attemptId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'attempt_id is required for reviewer agents',
          },
        });
      }
      // fg-32c2b: the project/deployment fix-loop mode decides who may
      // dispatch a fix. Reviewer agents need `auto`; humans need manual/auto.
      const source = req.agent ? 'reviewer' : 'human';
      await FixDispatchService.assertCanCreate(req.params.ticketId, source);
      const feedback = req.body?.feedback ?? null;

      const result = await FixRequestService.createOrEnsure(
        req.params.ticketId,
        {
          attemptId,
          feedback,
        },
        {
          actorId: req.runtime?.id ?? req.agent?.id
            ?? req.user?.userId ?? req.user?.id ?? null,
          // Keep the human's reason on the phase-history row.
          phaseMetadata: feedback ? { feedback } : null,
        }
      );
      res.status(result.created ? 201 : 200).json({
        success: true,
        data: result.request,
      });
    } catch (err) { next(err); }
  }
);

// The worker publishes the diff it produced; reviewers read PR diffs through
// GET /tickets/:ticketId/review/diff.
router.post('/:ticketId/review/local-diff', verifyTokenOrAgent, requireRuntime('running'), forTicketParam(), requireTicketGrant('worker'), async (req, res, next) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) {
      return res.status(400).json({ success: false, error: { message: 'files must be a non-empty array' } });
    }
    const MAX_FILES = 200;
    if (files.length > MAX_FILES) {
      return res.status(400).json({ success: false, error: { message: `Too many files (max ${MAX_FILES})` } });
    }
    const MAX_CONTENT_SIZE = 500 * 1024;
    for (const f of files) {
      if ((f.new_content && f.new_content.length > MAX_CONTENT_SIZE) ||
          (f.old_content && f.old_content.length > MAX_CONTENT_SIZE)) {
        return res.status(400).json({ success: false, error: { message: `File ${f.path} content exceeds max size` } });
      }
    }
    const result = await ReviewService.saveLocalDiff(req.params.ticketId, files);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/:ticketId/review/local-diff', verifyToken, async (req, res, next) => {
  try {
    const diffs = await ReviewService.getLocalDiff(req.params.ticketId);
    res.json({ success: true, data: { files: diffs } });
  } catch (err) { next(err); }
});

module.exports = router;
