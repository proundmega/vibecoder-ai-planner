const express = require('express');
const router = express.Router();
const auth = require('../auth');
const User = require('../models/user');

// Middleware
const { verifyToken, verifyTokenOrAgent, agentAuth, rateLimiter, trackAgentAction, recordFailedAttempt, clearFailedAttempts, checkAccountLockout, getLockoutRemainingMs } = require('../middleware/auth');
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
const permissionsRouter = require('./permissions');
const githubRouter = require('./github');
const providersRouter = require('./providers');
const credentialsRouter = require('./credentials');
const usageRouter = require('./usage');
const billingRouter = require('./billing');
const memoryRouter = require('./memory');
const ticketPlanningRouter = require('./ticketPlanning');
const ticketAttachmentRouter = require('./ticketAttachment');

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Health check
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     status: { type: string }
 *                     database: { type: string }
 *                     timestamp: { type: string, format: date-time }
 *       503:
 *         description: Database disconnected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
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

/**
 * @openapi
 * /version:
 *   get:
 *     tags: [System]
 *     summary: API version info
 *     security: []
 *     responses:
 *       200:
 *         description: API version information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     version: { type: string }
 *                     name: { type: string }
 */
router.get('/version', (req, res) => {
  res.json({
    success: true,
    data: { version: '1.0.0', name: 'Vibecode AI Planner API' },
    requestId: req.requestId,
  });
});

/**
 * @openapi
 * /docs:
 *   get:
 *     tags: [System]
 *     summary: API documentation index
 *     security: []
 *     responses:
 *       200:
 *         description: API documentation endpoints
 */
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

/**
 * @openapi
 * /metrics:
 *   get:
 *     tags: [System]
 *     summary: Server metrics
 *     responses:
 *       200:
 *         description: Server metrics including uptime and memory usage
 */
router.get('/metrics', (req, res) => {
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      database: {
        ...pool.stats(),
        status: pool.idleCount > 0 ? 'healthy' : 'degraded',
      },
    },
    requestId: req.requestId,
  });
});

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [user, member, project_admin, super_admin] }
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or user already exists
 */
router.post('/auth/register', rateLimiter(3, 60000), validate(registerSchema), async (req, res) => {
  try {
    const { name, email, password, role, user_created_by } = req.body;
    const result = await registerUserBound(name, email, password, role || 'project_admin', user_created_by || null);
    res.status(201).json({ ...result, message: 'Registration successful' });
  } catch (error) {
    console.error('POST /api/auth/register', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and get JWT token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 token: { type: string }
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials
 */
router.post('/auth/login', rateLimiter(5, 60000), validate(loginSchema), async (req, res) => {
  try {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    
    if (checkAccountLockout(clientIp)) {
      const remainingMs = getLockoutRemainingMs(clientIp);
      const retryAfter = Math.ceil(remainingMs / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ 
        error: 'Account locked due to too many failed attempts. Try again later.', 
        retryAfter 
      });
    }
    
    const { email, password } = req.body;
    const result = await loginUserBound(email, password);
    clearFailedAttempts(clientIp);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    recordFailedAttempt(clientIp);
    console.error('POST /api/auth/login', error);
    res.status(401).json({ error: error.message });
  }
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user info
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 authenticated: { type: boolean }
 *       401:
 *         description: Unauthorized
 */
router.get('/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await User.find(req.user.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.currentPlan, isActive: user.isActive }, authenticated: true });
  } catch (error) {
    console.error('GET /api/auth/me', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Authenticated routes
router.use('/users', verifyToken, usersManagementRouter);
router.use('/projects', verifyToken, projectsRouter);
router.use('/tickets', verifyTokenOrAgent, ticketsRouter);
router.use('/pricing', verifyToken, pricingRouter);
router.use('/agents', verifyToken, agentsRouter);
router.use('/approvals', verifyToken, approvalsRouter);
router.use('/permissions', permissionsRouter);
router.use('/github', verifyToken, githubRouter);
router.use('/providers', verifyToken, providersRouter);
router.use('/credentials', verifyToken, credentialsRouter);
router.use('/usage', verifyToken, usageRouter);
router.use('/billing', verifyToken, billingRouter);
router.use('/memory', verifyToken, memoryRouter);

// Planning routes (nested under tickets)
router.post('/tickets/:ticketId/planning/apply-template', verifyToken, ticketPlanningRouter.handleApplyTemplate);
router.patch('/tickets/:ticketId/planning/status', verifyToken, ticketPlanningRouter.handleUpdateStatus);
router.use('/tickets/:ticketId/planning', ticketPlanningRouter);

// Attachment routes (nested under tickets)
router.use('/tickets/:ticketId/attachments', ticketAttachmentRouter);

// Serve attachment files
router.get('/attachments/:attachmentId', verifyToken, ticketAttachmentRouter.handleGetFile);

module.exports = router;
