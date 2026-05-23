const express = require('express');
const router = express.Router();
const auth = require('../auth');

// Middleware
const { verifyToken, agentAuth, rateLimiter, trackAgentAction } = require('../middleware/auth');

const {
  register: registerUser,
  login: loginUser,
  verifyToken: verifyTokenHandler
} = auth;

const registerUserBound = registerUser.bind(auth);
const loginUserBound = loginUser.bind(auth);

const userRouter = require('./user');
const projectsRouter = require('./projects');
const ticketsRouter = require('./tickets');
const pricingRouter = require('./pricing');
const agentsRouter = require('./agents');

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API versioning
router.get('/version', (req, res) => {
  res.json({ version: '1.0.0', name: 'Vibecode AI Planner API' });
});

// Documentation
router.get('/docs', (req, res) => {
  res.json({
    title: 'API Documentation',
    endpoints: ['/api/auth/*', '/api/projects/*', '/api/tickets/*', '/api/pricing/*', '/api/agents/*']
  });
});

// Authentication routes (public)
router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const result = await registerUserBound(name, email, password);
    res.status(201).json({ ...result, message: 'Registration successful' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await loginUserBound(email, password);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

router.get('/auth/me', verifyToken, async (req, res) => {
  try {
    res.json({ user: req.user, authenticated: true });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Authenticated routes
router.use('/users', verifyToken, userRouter);
router.use('/projects', verifyToken, projectsRouter);
router.use('/tickets', verifyToken, ticketsRouter);
router.use('/pricing', verifyToken, pricingRouter);
router.use('/agents', verifyToken, agentsRouter);

module.exports = router;
