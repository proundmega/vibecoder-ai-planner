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
  origin: ['http://localhost:3000', 'http://192.168.3.33:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  logger('Health check called');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version endpoint
app.get('/api/version', (req, res) => {
  logger('Version check called');
  res.json({ version: '1.0.0' });
});

// Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger('Vibecode API Server running on port ' + PORT);
  logger('Environment: ' + (process.env.NODE_ENV || 'development'));
});

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
