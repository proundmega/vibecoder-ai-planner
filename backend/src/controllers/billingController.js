const BillingService = require('../services/BillingService');
const Project = require('../models/project');
const { NotFoundError } = require('../errors/HttpError');

async function getProjectBilling(req, res, next) {
  try {
    const { id } = req.params;
    const { month, start, end } = req.query;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    let billing;
    if (month) {
      billing = await BillingService.getProjectBilling(id, month);
    } else if (start && end) {
      billing = await BillingService.getProjectBillingRange(id, start, end);
    } else {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      billing = await BillingService.getUsageSince(id, since);
    }

    res.json({
      success: true,
      data: billing,
    });
  } catch (error) {
    next(error);
  }
}

async function getUserBilling(req, res, next) {
  try {
    const billing = await BillingService.getUserBilling(req.user.userId);

    res.json({
      success: true,
      data: billing,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProjectBilling,
  getUserBilling,
};
