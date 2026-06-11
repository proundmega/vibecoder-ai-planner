const MemoryService = require('../services/MemoryService');
const { NotFoundError } = require('../errors/HttpError');

async function addMemory(req, res, next) {
  try {
    const { content, metadata } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Content is required',
        },
      });
    }

    const memory = await MemoryService.addMemory(
      parseInt(req.params.projectId),
      req.user.userId,
      content,
      metadata || {}
    );

    res.status(201).json({ success: true, data: memory });
  } catch (error) {
    next(error);
  }
}

async function getMemory(req, res, next) {
  try {
    const memory = await MemoryService.getMemory(parseInt(req.params.id));

    if (!memory) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Memory not found',
        },
      });
    }

    res.json({ success: true, data: memory });
  } catch (error) {
    next(error);
  }
}

async function getProjectMemory(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const memories = await MemoryService.getProjectMemory(
      parseInt(req.params.projectId),
      limit,
      offset
    );

    res.json({ success: true, data: memories });
  } catch (error) {
    next(error);
  }
}

async function getAgentMemory(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const memories = await MemoryService.getAgentMemory(
      parseInt(req.params.agentId),
      limit,
      offset
    );

    res.json({ success: true, data: memories });
  } catch (error) {
    next(error);
  }
}

async function searchMemory(req, res, next) {
  try {
    const { query } = req.query;
    const limit = parseInt(req.query.limit) || 10;
    const threshold = parseFloat(req.query.threshold) || 0.3;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter is required',
        },
      });
    }

    const memories = await MemoryService.searchSimilar(
      parseInt(req.params.projectId),
      query,
      limit,
      threshold
    );

    res.json({ success: true, data: memories });
  } catch (error) {
    next(error);
  }
}

async function updateMemory(req, res, next) {
  try {
    const { content, metadata } = req.body;

    const memory = await MemoryService.updateMemory(
      parseInt(req.params.id),
      content,
      metadata
    );

    res.json({ success: true, data: memory });
  } catch (error) {
    next(error);
  }
}

async function deleteMemory(req, res, next) {
  try {
    const memory = await MemoryService.deleteMemory(parseInt(req.params.id));

    res.json({ success: true, data: memory });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addMemory,
  getMemory,
  getProjectMemory,
  getAgentMemory,
  searchMemory,
  updateMemory,
  deleteMemory,
};
