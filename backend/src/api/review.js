const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const ReviewService = require('../services/ReviewService');

router.post('/:ticketId/review/local-diff', verifyTokenOrAgent, async (req, res, next) => {
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
