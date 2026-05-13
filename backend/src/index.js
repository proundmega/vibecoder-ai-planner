require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.simple()
      )
    })
  ],
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://192.168.3.33:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  logger.info('Health check called');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version endpoint
app.get('/api/version', (req, res) => {
  logger.info('Version check called');
  res.json({ version: '1.0.0' });
});

// Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info('Vibecode API Server running on port ' + PORT);
  logger.info('Environment: ' + (process.env.NODE_ENV || 'development'));
});

server.on('error', (err) => {
  logger.error('Server error:', err);
  process.exit(1);
});

const gracefulShutdown = (signal) => {
  logger.info(signal + ' received. Shutting down gracefully.');
  server.close((err) => {
    if (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
