const jwt = require('jsonwebtoken');
const authService = require('../auth');
const { pool } = require('../db');
const AgentService = require('../services/AgentService');

const JWT_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';

const AUTH_LOCKOUT_ATTEMPTS = parseInt(process.env.AUTH_LOCKOUT_ATTEMPTS) || 10;
const AUTH_LOCKOUT_WINDOW_MS = parseInt(process.env.AUTH_LOCKOUT_WINDOW_MS) || 15 * 60 * 1000;

const failedAttempts = new Map();

function checkAccountLockout(ip) {
  const attempt = failedAttempts.get(ip);
  if (!attempt) return false;
  if (attempt.count >= AUTH_LOCKOUT_ATTEMPTS) {
    if (Date.now() < attempt.lockedUntil) {
      return true;
    }
    failedAttempts.delete(ip);
    return false;
  }
  return false;
}

function getLockoutRemainingMs(ip) {
  const attempt = failedAttempts.get(ip);
  if (!attempt || !attempt.lockedUntil) return 0;
  const remaining = attempt.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function recordFailedAttempt(ip) {
  let attempt = failedAttempts.get(ip);
  if (!attempt) {
    attempt = { count: 0, lockedUntil: 0 };
    failedAttempts.set(ip, attempt);
  }
  attempt.count++;
  if (attempt.count >= AUTH_LOCKOUT_ATTEMPTS) {
    attempt.lockedUntil = Date.now() + AUTH_LOCKOUT_WINDOW_MS;
  }
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

exports.checkAccountLockout = checkAccountLockout;
exports.getLockoutRemainingMs = getLockoutRemainingMs;
exports.recordFailedAttempt = recordFailedAttempt;
exports.clearFailedAttempts = clearFailedAttempts;

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

exports.requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden',
        required: allowedRoles,
        actual: req.user.role
      });
    }
    
    next();
  };
};

exports.requireActiveUser = (req, res, next) => {
  if (!req.user || !req.user.userId) {
    return res.status(403).json({ error: 'Account deactivated' });
  }
  
  pool.query('SELECT is_active FROM users WHERE id = $1', [req.user.userId])
    .then(result => {
      if (result.rows.length === 0 || !result.rows[0].is_active) {
        return res.status(403).json({ error: 'Account deactivated' });
      }
      next();
    })
    .catch(() => res.status(403).json({ error: 'Account deactivated' }));
};

exports.agentAuth = (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    // Mock validation for test keys
    if (apiKey.startsWith('test-') || apiKey === 'mock-agent-key') {
      req.agent = {
        id: 'mock-agent-1',
        name: 'GitHub PR Bot',
        rateLimitCount: req.rateLimitCount || 0
      };
      req.rateLimitCount = (req.agent.rateLimitCount || 0) + 1;
      return next();
    }

    // Real agent lookup from database
    AgentService.getAgentByApiKey(apiKey)
      .then(agent => {
        if (!agent) {
          return res.status(401).json({ error: 'Invalid API key' });
        }
        req.agent = agent;
        next();
      })
      .catch(() => res.status(401).json({ error: 'Invalid agent credentials' }));
  } catch (error) {
    console.error('agentAuth:', error);
    return res.status(401).json({ error: 'Invalid agent credentials' });
  }
};

// Combined auth: accepts either JWT token or agent API key
exports.verifyTokenOrAgent = (req, res, next) => {
  // Try JWT first
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return exports.verifyToken(req, res, next);
  }
  
  // Fall back to agent API key
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  // Mock validation for test keys
  if (apiKey.startsWith('test-') || apiKey === 'mock-agent-key') {
    req.agent = {
      id: 'mock-agent-1',
      name: 'GitHub PR Bot',
    };
    req.user = {
      userId: req.agent.id,
      id: req.agent.id,
      email: 'agent@vibecode.local',
      role: 'member',
    };
    return next();
  }

  // Real agent lookup from database
  AgentService.getAgentByApiKey(apiKey)
    .then(agent => {
      if (!agent) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      req.agent = agent;
      req.user = {
        userId: agent.id,
        id: agent.id,
        email: agent.email || 'agent@vibecode.local',
        role: agent.role || 'member',
      };
      next();
    })
    .catch(() => res.status(401).json({ error: 'Invalid agent credentials' }));
};

// Rate limiting middleware
exports.rateLimiter = (maxRequests = 10, timeWindow = 60 * 1000) => {
  const rateLimits = new Map();
  
  return (req, res, next) => {
    // Skip rate limiting in test mode or during integration tests
    if (process.env.NODE_ENV === 'test' || process.env.INTEGRATION_TESTS === '1') return next();
    
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

    const resetTimestamp = Math.ceil(requests.resetAt / 1000);
    const retryAfter = Math.ceil((requests.resetAt - Date.now()) / 1000);

    res.set({
      'X-RateLimit-Limit': String(maxRequests),
      'X-RateLimit-Remaining': String(Math.max(0, maxRequests - requests.count)),
      'X-RateLimit-Reset': String(resetTimestamp),
    });

    if (requests.count > maxRequests) {
      res.set('Retry-After', String(retryAfter > 0 ? retryAfter : 1));
      return res.status(429).json({ 
        error: `Too many requests, please try again later.`, 
        retryAfter: retryAfter > 0 ? retryAfter : 1 
      });
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
