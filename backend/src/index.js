require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const logger = console.info.bind(console);

logger('Starting Vibecode API...');

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID tracking
const { requestId } = require('./middleware/requestId');
app.use(requestId);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger(`${req.method} ${req.path} ${res.statusCode} - ${Date.now() - start}ms`);
  });
  next();
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
    logger('Vibecode API Server running on port ' + PORT);
    logger('Environment: ' + (process.env.NODE_ENV || 'development'));
  });
}

if (server) {
  server.on('error', (err) => {
    logger('Server error:', err);
    process.exit(1);
  });

  const shutdown = (signal) => {
    logger(signal + ' received. Shutting down.');
    server.close(() => {
      logger('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Global unhandled exceptions and rejections
process.on('unhandledRejection', (reason, promise) => {
  logger('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

module.exports = app;
