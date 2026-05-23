const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');

// Get all pricing tiers
router.get('/tiers', verifyToken, async (req, res) => {
  try {
    res.json([
      {
        id: 'free',
        name: 'Free',
        price: 0,
        includedCostLimit: 100,
        features: ['Basic projects', 'Up to 10 active projects', 'Community support']
      },
      {
        id: 'pro',
        name: 'Professional',
        price: 29,
        includedCostLimit: 1000,
        features: ['Unlimited projects', 'AI agent access', 'Priority support', 'Advanced analytics']
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 99,
        includedCostLimit: null,
        features: ['Unlimited everything', 'Custom AI models', 'Dedicated support', 'SSO', 'Custom integrations']
      }
    ]);
  } catch (error) {
    console.error('GET /api/pricing/tiers', error);
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
    console.error('GET /api/pricing/user/:userId', error);
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
    console.error('POST /api/pricing/checkout', error);
    res.status(500).json({ error: error.message });
  }
});

// Upgrade subscription (stub)
router.post('/upgrade/:userId', verifyToken, async (req, res) => {
  try {
    const { tierId } = req.body;
    res.json({ message: 'Subscription upgraded', plan: tierId });
  } catch (error) {
    console.error('POST /api/pricing/upgrade/:userId', error);
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
    console.error('GET /api/pricing/usage', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
