require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('./middleware/cors');

const logger = require('./utils/logger');

logger.info('Starting Vibecode API...');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

// Middleware
app.use(helmet({
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

// Error handler
const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

// Start server (skip in test mode — supertest uses the app directly)
const PORT = process.env.PORT || 3001;
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info(`Vibecode API Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

if (server) {
  server.on('error', (err) => {
    logger.error('Server error:', err);
    process.exit(1);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received. Shutting down.`);
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
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
