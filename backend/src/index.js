require('dotenv').config();
require('./utils/envValidation');
const express = require('express');
const helmet = require('helmet');
const cors = require('./middleware/cors');

const logger = require('./utils/logger');
const { gracefulShutdown } = require('./utils/shutdown');
const HeartbeatService = require('./services/HeartbeatService');

logger.info('Starting Vibecode API...');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3002')
  .split(',')
  .map(o => o.trim());

// Middleware
app.use(helmet({
  serverHeader: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
}));
app.use(cors(allowedOrigins));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID tracking
const { requestId } = require('./middleware/requestId');
app.use(requestId);

// Request logging
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// OpenAPI spec and Swagger UI
const swaggerUi = require('swagger-ui-express');
const specs = require('./api/openapi-spec');
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Vibecode API Docs',
}));
app.get('/api/openapi.json', (req, res) => {
  res.json(specs);
});

// Routes
const routes = require('./api/routes');
app.use('/api', routes);

// Prometheus metrics endpoint (at root level, not under /api)
const { register } = require('./metrics');
if (process.env.NODE_ENV !== 'test') {
  const collectDefaultMetrics = require('prom-client').collectDefaultMetrics;
  collectDefaultMetrics({ register });
}

app.get('/metrics', async (req, res, next) => {
  try {
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken) {
      const providedToken = req.headers['x-metrics-token'];
      if (!providedToken || providedToken !== metricsToken) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Metrics endpoint requires authentication' } });
      }
    }
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    next(error);
  }
});

// WebSocket upgrade handler for terminal proxy (only in non-test mode)
let server;
let wss;

// Error handler
const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

// Start server (skip in test mode — supertest uses the app directly)
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info(`Vibecode API Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  server.on('error', (err) => {
    logger.error('Server error:', err);
    process.exit(1);
  });

  // WebSocket upgrade handler for terminal proxy
  const { createTerminalWSS, verifyTerminalToken } = require('./api/terminal');
  wss = createTerminalWSS();

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');

    if (!url.pathname.startsWith('/api/terminal/')) {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');

    try {
      const user = verifyTerminalToken(token);
      if (user.role !== 'super_admin') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = user;
        wss.emit('connection', ws, request);
      });
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  const { pool } = require('./db');

  // Periodically clean up stale agents
  const cleanupInterval = setInterval(() => {
    HeartbeatService.cleanupStaleAgents().catch(err => {
      logger.error('Stale agent cleanup failed:', err.message);
    });
  }, 60000);

  gracefulShutdown(server, pool, [() => clearInterval(cleanupInterval)]);
}

// Global unhandled exceptions and rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

module.exports = app;
