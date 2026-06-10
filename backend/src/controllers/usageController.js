const UsageLogger = require('../services/UsageLogger');
const Project = require('../models/project');
const { NotFoundError } = require('../errors/HttpError');

async function getProjectUsage(req, res, next) {
  try {
    const { id } = req.params;
    const { since, until } = req.query;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const untilDate = until ? new Date(until) : new Date();

    const usage = await UsageLogger.getProjectUsage(id, sinceDate, untilDate);
    const totals = await UsageLogger.getTotalUsage(id, sinceDate, untilDate);

    res.json({
      success: true,
      data: {
        breakdown: usage,
        totals: {
          totalTokensIn: parseInt(totals.total_in) || 0,
          totalTokensOut: parseInt(totals.total_out) || 0,
          totalCost: parseFloat(totals.total_cost) || 0,
          totalCalls: parseInt(totals.total_calls) || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getUserUsage(req, res, next) {
  try {
    const { since, until } = req.query;

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const untilDate = until ? new Date(until) : new Date();

    const usage = await UsageLogger.getUserUsage(req.user.userId, sinceDate, untilDate);

    res.json({
      success: true,
      data: usage,
    });
  } catch (error) {
    next(error);
  }
}

async function getModelPricing(req, res, next) {
  try {
    const { getAllModels, getModelPricing } = require('../utils/pricing');

    const models = getAllModels().map(model => ({
      model,
      pricing: getModelPricing(model),
    }));

    res.json({
      success: true,
      data: { models },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProjectUsage,
  getUserUsage,
  getModelPricing,
};
