const express = require('express');
const router = express.Router();
const auth = require('../auth');

// Middleware
const { verifyToken, agentAuth, rateLimiter, trackAgentAction } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validators/auth');

const { pool } = require('../db');

const {
  register: registerUser,
  login: loginUser,
  verifyToken: verifyTokenHandler
} = auth;

const registerUserBound = registerUser.bind(auth);
const loginUserBound = loginUser.bind(auth);

const userRouter = require('./user');
const usersManagementRouter = require('./users');
const projectsRouter = require('./projects');
const ticketsRouter = require('./tickets');
const pricingRouter = require('./pricing');
const agentsRouter = require('./agents');
const approvalsRouter = require('./approvals');

// Health check
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      success: true,
      data: { 
        status: 'ok', 
        database: 'connected', 
        timestamp: new Date().toISOString(),
      },
      requestId: req.requestId,
    });
  } catch (error) {
    res.status(503).json({ 
      success: false,
      error: {
        code: 'DATABASE_DISCONNECTED',
        message: 'Database connection failed',
      },
      requestId: req.requestId,
    });
  }
});

// API versioning
router.get('/version', (req, res) => {
  res.json({
    success: true,
    data: { version: '1.0.0', name: 'Vibecode AI Planner API' },
    requestId: req.requestId,
  });
});

// Documentation
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    data: {
      title: 'API Documentation',
      endpoints: ['/api/auth/*', '/api/users/*', '/api/projects/*', '/api/tickets/*', '/api/pricing/*', '/api/agents/*']
    },
    requestId: req.requestId,
  });
});

// Authentication routes (public)
router.post('/auth/register', validate(registerSchema), async (req, res) => {
  try {
    const { name, email, password, role, user_created_by } = req.body;
    const result = await registerUserBound(name, email, password, role || 'user', user_created_by || null);
    res.status(201).json({ ...result, message: 'Registration successful' });
  } catch (error) {
    console.error('POST /api/auth/register', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/auth/login', validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await loginUserBound(email, password);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    console.error('POST /api/auth/login', error);
    res.status(401).json({ error: error.message });
  }
});

router.get('/auth/me', verifyToken, async (req, res) => {
  try {
    res.json({ user: req.user, authenticated: true });
  } catch (error) {
    console.error('GET /api/auth/me', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Authenticated routes
router.use('/users', verifyToken, usersManagementRouter);
router.use('/projects', verifyToken, projectsRouter);
router.use('/tickets', verifyToken, ticketsRouter);
router.use('/pricing', verifyToken, pricingRouter);
router.use('/agents', verifyToken, agentsRouter);
router.use('/approvals', verifyToken, approvalsRouter);

module.exports = router;
