const jwt = require('jsonwebtoken');
const authService = require('../auth');

const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

exports.verifyToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('verifyToken:', error);
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
};

exports.agentAuth = (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    // Mock validation
    if (!apiKey.startsWith('test-') && !apiKey === 'mock-agent-key') {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.agent = {
      id: 'mock-agent-1',
      name: 'GitHub PR Bot',
      rateLimitCount: req.rateLimitCount || 0
    };
    req.rateLimitCount = (req.agent.rateLimitCount || 0) + 1;
    
    next();
  } catch (error) {
    console.error('agentAuth:', error);
    return res.status(401).json({ error: 'Invalid agent credentials' });
  }
};

// Rate limiting middleware
exports.rateLimiter = (maxRequests = 10, timeWindow = 60 * 1000) => {
  const rateLimits = new Map();
  
  return (req, res, next) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    let requests = rateLimits.get(clientIp);
    
    if (!requests) {
      requests = { count: 1, resetAt: Date.now() + timeWindow };
      rateLimits.set(clientIp, requests);
    } else if (Date.now() > requests.resetAt) {
      requests = { count: 1, resetAt: Date.now() + timeWindow };
      rateLimits.set(clientIp, requests);
    } else {
      requests.count++;
    }

    if (requests.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }

    req.rateLimits = { [clientIp]: requests };
    next();
  };
};

// Agent action tracking with cost
exports.trackAgentAction = (req, res, next) => {
  req.isAgentAction = true;
  req.agentActionData = {
    action_type: req.method,
    table_name: req.tableName || 'unknown',
    record_id: req.recordId,
    ai_id: req.agent?.name,
    cost_incurred: 0.05
  };
  next();
};
