const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const { MODEL_PRICING, getModelPricing, getAllModels } = require('../utils/pricing');

// Get all pricing tiers (model pricing data)
router.get('/tiers', verifyToken, async (req, res) => {
  try {
    const tiers = Object.entries(MODEL_PRICING)
      .filter(([key]) => key !== 'default')
      .map(([model, pricing]) => ({
        model,
        pricing,
      }));
    res.json({ success: true, data: tiers });
  } catch (error) {
    logger.error('GET /api/pricing/tiers', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's current plan
router.get('/user/:userId', verifyToken, async (req, res) => {
  try {
    res.json({
      userId: req.params.userId,
      currentPlan: 'pro',
      usage: {
        ticketsThisMonth: 42,
        costAccumulated: 21.5
      },
      upgradeAvailable: true
    });
  } catch (error) {
    logger.error('GET /api/pricing/user/:userId', error);
    res.status(500).json({ error: error.message });
  }
});

// Create checkout session
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    res.json({
      sessionId,
      tierId: req.body.tierId,
      checkoutUrl: `https://checkout.example.com/session/${sessionId}`
    });
  } catch (error) {
    logger.error('POST /api/pricing/checkout', error);
    res.status(500).json({ error: error.message });
  }
});

// Upgrade subscription (stub)
router.post('/upgrade/:userId', verifyToken, async (req, res) => {
  try {
    const { tierId } = req.body;
    res.json({ message: 'Subscription upgraded', plan: tierId });
  } catch (error) {
    logger.error('POST /api/pricing/upgrade/:userId', error);
    res.status(500).json({ error: error.message });
  }
});

// Get usage statistics with AI agent cost tracking
router.get('/usage', verifyToken, async (req, res) => {
  try {
    res.json({
      monthlyLimit: 1000,
      used: 450,
      aiActionsToday: 23,
      aiCostToday: 1.15,
      remaining: 550
    });
  } catch (error) {
    logger.error('GET /api/pricing/usage', error);
    res.status(500).json({ error: error.message });
  }
});

// Get model pricing data
router.get('/models', verifyToken, async (req, res) => {
  try {
    res.json({ success: true, data: { models: getAllModels(), pricing: MODEL_PRICING } });
  } catch (error) {
    logger.error('GET /api/pricing/models', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pricing for a specific model
router.get('/model/:modelName', verifyToken, async (req, res) => {
  try {
    const pricing = getModelPricing(req.params.modelName);
    res.json({ success: true, data: { model: req.params.modelName, pricing } });
  } catch (error) {
    logger.error('GET /api/pricing/model/:modelName', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
