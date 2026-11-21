const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const { recordAuthEvent } = require('./agentRole');
const { authFailureCounter } = require('../services/AgentEnrollmentMetrics');
const { getSecret } = require('../utils/jwt');
const IpWhitelistService = require('../services/IpWhitelistService');
const {
  getRedis,
  isRedisAvailable,
  set,
  get,
  del,
  evalScript,
} = require('../utils/redis');

const AUTH_LOCKOUT_ATTEMPTS = parseInt(process.env.AUTH_LOCKOUT_ATTEMPTS) || 10;
const AUTH_LOCKOUT_WINDOW_MS = parseInt(process.env.AUTH_LOCKOUT_WINDOW_MS) || 15 * 60 * 1000;

// In-memory fallback stores
const failedAttempts = new Map();
const rateLimits = new Map();

// Lua script for atomic sliding window rate limiting
const RATE_LIMIT_LUA_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  local count = redis.call('ZCARD', KEYS[1])
  if count >= tonumber(ARGV[2]) then
    return {1, count, 0}
  end
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[3] .. ':' .. math.random())
  redis.call('EXPIRE', KEYS[1], math.ceil(ARGV[4] / 1000) + 1)
  return {0, count + 1, ARGV[4]}
`;

async function checkAccountLockout(ip) {
  // Skip lockout during integration tests
  if (process.env.INTEGRATION_TESTS === '1') return false;
  
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const data = await getRedis().get(`lockout:${ip}`);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.count >= AUTH_LOCKOUT_ATTEMPTS) {
          if (Date.now() < parsed.lockedUntil) {
            return true;
          }
          await del(`lockout:${ip}`);
          return false;
        }
      }
      return false;
    } catch (err) {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
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

async function getLockoutRemainingMs(ip) {
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const data = await getRedis().get(`lockout:${ip}`);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.lockedUntil) {
          const remaining = parsed.lockedUntil - Date.now();
          return remaining > 0 ? remaining : 0;
        }
      }
      return 0;
    } catch (err) {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const attempt = failedAttempts.get(ip);
  if (!attempt || !attempt.lockedUntil) return 0;
  const remaining = attempt.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

async function recordFailedAttempt(ip) {
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const existing = await get(`lockout:${ip}`);
      let count = 1;
      let lockedUntil = 0;

      if (existing) {
        const parsed = JSON.parse(existing);
        count = parsed.count + 1;
        lockedUntil = parsed.lockedUntil || 0;
      }

      if (count >= AUTH_LOCKOUT_ATTEMPTS && lockedUntil === 0) {
        lockedUntil = Date.now() + AUTH_LOCKOUT_WINDOW_MS;
      }

      await set(`lockout:${ip}`, JSON.stringify({ count, lockedUntil }), Math.ceil(AUTH_LOCKOUT_WINDOW_MS / 1000));
      return;
    } catch (err) {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
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

async function clearFailedAttempts(ip) {
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      await del(`lockout:${ip}`);
    } catch (err) {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
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

    const decoded = jwt.verify(token, getSecret());
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

exports.requireActiveUser = async (req, res, next) => {
  if (!req.user || !req.user.userId) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Account deactivated' } });
  }
  
  try {
    const result = await pool.query('SELECT is_active FROM users WHERE id = $1', [req.user.userId]);
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Account deactivated' } });
    }
    next();
  } catch (err) {
    console.error('requireActiveUser DB error:', err.message);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
  }
};

/**
 * A node credential authenticates the host; every node call must name the
 * child runtime it acts for. Rejecting runtime-less node tokens here keeps a
 * host token from falling back to the legacy unscoped agent path.
 */
async function requireNodeRuntime(agent, req, res) {
  if (!agent._node || agent._runtime) return true;
  await recordAuthEvent({
    nodeId: agent._nodeRecord ? agent._nodeRecord.id : null,
    eventType: 'auth.runtime_missing',
    actorType: 'node',
    actorId: agent._nodeRecord ? agent._nodeRecord.id : null,
    ip: req.ip || null,
    metadata: { path: req.originalUrl || req.path || null },
  });
  res.status(400).json({
    success: false,
    error: {
      code: 'RUNTIME_REQUIRED',
      message: 'X-Agent-Runtime header is required for node credentials',
    },
  });
  return false;
}

function agentAuthFailure(agent) {
  if (agent._revoked) {
    return {
      code: 'TOKEN_REVOKED',
      message: 'Node credentials have been revoked',
    };
  }
  return {
    code: 'TOKEN_EXPIRED',
    message: 'Node access token expired; refresh the node credentials',
    expiredAt: agent.api_key_expires_at || undefined,
  };
}

async function authenticateAgentByApiKey(apiKey, { mock = true, runtimeId = null } = {}) {
  // Mock validation for test keys (unit tests only; never in a deployment).
  if (mock && process.env.NODE_ENV === 'test') {
    if (apiKey === 'agent-key') {
      return {
        id: 7,
        owner_id: 1,
        name: 'Test Agent',
        rateLimitCount: 0,
        _mock: true,
      };
    }
    if (apiKey.startsWith('test-') || apiKey === 'mock-agent-key') {
      return {
        id: 1,
        owner_id: 1,
        name: 'Test Agent',
        rateLimitCount: 0,
        _mock: true,
      };
    }
  }

  // Node access tokens use the X-API-Key header.
  if (apiKey.startsWith('at_')) {
    const result = await AgentNodeService.authenticateAccessToken(apiKey);
    if (result.status === 'ok') {
      const node = result.node;
      let runtime = null;
      if (runtimeId) {
        try {
          runtime = await AgentNodeService.getRuntimeForNode(node.id, runtimeId);
        } catch {
          authFailureCounter.inc({ reason: 'invalid' });
          return null;
        }
      }
      return {
        ...node,
        id: runtime ? runtime.id : node.id,
        node_id: node.id,
        runtime_id: runtime ? runtime.id : null,
        project_id: runtime ? runtime.current_project_id : null,
        _node: true,
        _nodeRecord: node,
        _runtime: runtime,
        _tokenKind: 'access',
      };
    }
    if (result.status === 'expired') {
      authFailureCounter.inc({ reason: 'expired' });
      return {
        _tokenKind: 'access',
        _expired: true,
        api_key_expires_at: result.expiresAt || null,
      };
    }
    if (result.status === 'revoked') {
      authFailureCounter.inc({ reason: 'revoked' });
      return { _tokenKind: 'access', _revoked: true };
    }
    authFailureCounter.inc({ reason: 'invalid' });
    return null;
  }

  authFailureCounter.inc({ reason: 'invalid' });
  return null;
}

exports.authenticateAgentByApiKey = authenticateAgentByApiKey;
exports.agentAuthFailure = agentAuthFailure;

exports.agentAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing API key' } });
    }

    const agent = await authenticateAgentByApiKey(apiKey, {
      runtimeId: req.headers['x-agent-runtime'] || null,
    });
    if (!agent) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    }

    if (agent._expired || agent._revoked) {
      return res.status(401).json({ success: false, error: agentAuthFailure(agent) });
    }

    if (!(await requireNodeRuntime(agent, req, res))) return;

    req.agent = agent;
    if (agent._node) {
      req.node = agent._nodeRecord;
      req.runtime = agent._runtime;
    }
    req.rateLimitCount = req.rateLimitCount || 0;
    next();
  } catch (error) {
    console.error('agentAuth:', error);
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid agent credentials' } });
  }
};

// Combined auth: accepts either JWT token or agent API key
exports.verifyTokenOrAgent = async (req, res, next) => {
  // Try JWT first
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return exports.verifyToken(req, res, next);
  }
  
  // Fall back to agent API key
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing authentication token' } });
  }

  try {
    const agent = await authenticateAgentByApiKey(apiKey, {
      runtimeId: req.headers['x-agent-runtime'] || null,
    });
    if (!agent) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    }

    if (agent._expired || agent._revoked) {
      return res.status(401).json({ success: false, error: agentAuthFailure(agent) });
    }

    if (!(await requireNodeRuntime(agent, req, res))) return;

    req.agent = agent;
    if (agent._node) {
      req.node = agent._nodeRecord;
      req.runtime = agent._runtime;
    }
    req.user = {
      userId: agent.owner_id,
      id: agent.id,
      email: agent.email || 'agent@vibecode.local',
      role: agent.role || 'member',
    };
    // Ensure role always has a value (agents table has no role column)
    if (!req.user.role) {
      req.user.role = 'member';
    }
    next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid agent credentials' } });
  }
};

// Rate limiting middleware with Redis-backed sliding window
exports.rateLimiter = (maxRequests = 10, timeWindow = 60 * 1000) => {
  return async (req, res, next) => {
    // Skip rate limiting during integration tests
    if (process.env.INTEGRATION_TESTS === '1') return next();
    
    // Check IP whitelist
    try {
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      const isWhitelisted = await IpWhitelistService.isWhitelisted(clientIp);
      if (isWhitelisted) {
        return next();
      }
    } catch (error) {
      console.error('IP whitelist check failed:', error.message);
    }
    
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `ratelimit:${clientIp}`;
    
    // Try Redis sliding window first
    if (isRedisAvailable()) {
      try {
        const now = Date.now();
        const windowStart = now - timeWindow; // Prune entries outside the window
        
        const result = await evalScript(
          RATE_LIMIT_LUA_SCRIPT,
          [key],
          [String(windowStart), String(maxRequests), String(now), String(timeWindow)]
        );
        
        if (result) {
          const [limited, count, _ttl] = result;
          const resetTimestamp = Math.ceil((now + timeWindow) / 1000);
          const retryAfter = Math.ceil((now + timeWindow - now) / 1000);
          
          res.set({
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Remaining': String(Math.max(0, maxRequests - count)),
            'X-RateLimit-Reset': String(resetTimestamp),
          });
          
          if (limited === 1) {
            res.set('Retry-After', String(retryAfter > 0 ? retryAfter : 1));
            return res.status(429).json({ 
              error: 'Too many requests, please try again later.', 
              retryAfter: retryAfter > 0 ? retryAfter : 1 
            });
          }
          
          req.rateLimits = { [clientIp]: { count, resetAt: now + timeWindow } };
          return next();
        }
      } catch (err) {
        // Fall through to in-memory
      }
    }
    
    // In-memory fallback
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
        error: 'Too many requests, please try again later.', 
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
