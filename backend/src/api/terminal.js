const jwt = require('jsonwebtoken');

function verifyTerminalToken(token) {
  if (!token) throw new Error('Missing token');
  return jwt.verify(token, process.env.JWT_SECRET);
}

function createTerminalWSS() {
  const { WebSocketServer } = require('ws');
  const { TerminalProxy } = require('../services/TerminalProxy');
  const logger = require('../utils/logger');

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const agentId = url.pathname.split('/').pop();
    const proxy = new TerminalProxy(ws, agentId);
    proxy.start().catch((err) => {
      logger.error('Terminal session error: %s', err.message);
      ws.close(1011, err.message);
    });
  });

  return wss;
}

module.exports = { verifyTerminalToken, createTerminalWSS };
