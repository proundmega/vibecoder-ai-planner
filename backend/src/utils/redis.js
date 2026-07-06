const Redis = require('ioredis');
const logger = require('./logger');

let redisClient = null;
let isAvailable = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 1000;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'vibecode:';

function getPrefixedKey(key) {
  return `${REDIS_PREFIX}${key}`;
}

function connectRedis() {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: (times) => {
      reconnectAttempts = times;
      if (times > MAX_RECONNECT_ATTEMPTS) {
        logger.warn(`Redis reconnect failed after ${times} attempts. Falling back to in-memory.`);
        isAvailable = false;
        return null;
      }
      const delay = Math.min(times * RECONNECT_DELAY_MS, 5000);
      logger.warn(`Redis connection lost. Retrying in ${delay}ms (attempt ${times})...`);
      return delay;
    },
  });

  redisClient.on('error', (err) => {
    logger.error(`Redis error: ${err.message}`);
    isAvailable = false;
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected successfully.');
  });

  redisClient.on('ready', () => {
    isAvailable = true;
    reconnectAttempts = 0;
    logger.info('Redis connection ready.');
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed.');
    isAvailable = false;
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
    isAvailable = false;
  });

  return redisClient;
}

async function ensureConnected() {
  if (redisClient && isAvailable) {
    return true;
  }

  try {
    if (!redisClient) {
      connectRedis();
    }
    await redisClient.ping();
    isAvailable = true;
    return true;
  } catch (err) {
    logger.warn(`Redis unavailable: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return false;
  }
}

async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis connection closed gracefully.');
    } catch (err) {
      logger.error(`Error closing Redis: ${err.message}`);
    }
    redisClient = null;
    isAvailable = false;
  }
}

function isRedisAvailable() {
  return isAvailable && redisClient !== null;
}

async function get(key) {
  if (!isAvailable) {
    return null;
  }
  try {
    const prefixed = getPrefixedKey(key);
    const value = await redisClient.get(prefixed);
    return value;
  } catch (err) {
    logger.warn(`Redis GET failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  if (!isAvailable) {
    return false;
  }
  try {
    const prefixed = getPrefixedKey(key);
    if (ttlSeconds) {
      await redisClient.setex(prefixed, ttlSeconds, value);
    } else {
      await redisClient.set(prefixed, value);
    }
    return true;
  } catch (err) {
    logger.warn(`Redis SET failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return false;
  }
}

async function del(key) {
  if (!isAvailable) {
    return 0;
  }
  try {
    const prefixed = getPrefixedKey(key);
    return await redisClient.del(prefixed);
  } catch (err) {
    logger.warn(`Redis DEL failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return 0;
  }
}

async function zadd(key, score, member) {
  if (!isAvailable) {
    return 0;
  }
  try {
    const prefixed = getPrefixedKey(key);
    return await redisClient.zadd(prefixed, score, member);
  } catch (err) {
    logger.warn(`Redis ZADD failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return 0;
  }
}

async function zremrangebyscore(key, min, max) {
  if (!isAvailable) {
    return 0;
  }
  try {
    const prefixed = getPrefixedKey(key);
    return await redisClient.zremrangebyscore(prefixed, min, max);
  } catch (err) {
    logger.warn(`Redis ZREMRANGEBYSCORE failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return 0;
  }
}

async function zcard(key) {
  if (!isAvailable) {
    return 0;
  }
  try {
    const prefixed = getPrefixedKey(key);
    return await redisClient.zcard(prefixed);
  } catch (err) {
    logger.warn(`Redis ZCARD failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return 0;
  }
}

async function expire(key, ttlSeconds) {
  if (!isAvailable) {
    return 0;
  }
  try {
    const prefixed = getPrefixedKey(key);
    return await redisClient.expire(prefixed, ttlSeconds);
  } catch (err) {
    logger.warn(`Redis EXPIRE failed for key ${key}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return 0;
  }
}

async function evalScript(script, keys, args) {
  if (!isAvailable) {
    return null;
  }
  try {
    return await redisClient.eval(script, keys.length, ...keys, ...args);
  } catch (err) {
    logger.warn(`Redis EVAL failed: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return null;
  }
}

async function scan(match, count) {
  if (!isAvailable) {
    return [];
  }
  try {
    const prefixedMatch = getPrefixedKey(match);
    const cursor = '0';
    const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', prefixedMatch, 'COUNT', count || 100);
    return keys.map(key => key.slice(REDIS_PREFIX.length));
  } catch (err) {
    logger.warn(`Redis SCAN failed for pattern ${match}: ${err.message}. Falling back to in-memory.`);
    isAvailable = false;
    return [];
  }
}

async function healthCheck() {
  if (!isAvailable || !redisClient) {
    return { status: 'unavailable', error: 'Redis not connected' };
  }
  try {
    await redisClient.ping();
    return { status: 'healthy' };
  } catch (err) {
    return { status: 'unhealthy', error: err.message };
  }
}

module.exports = {
  connectRedis,
  ensureConnected,
  closeRedis,
  isRedisAvailable,
  getRedis: () => redisClient,
  get,
  set,
  del,
  zadd,
  zremrangebyscore,
  zcard,
  expire,
  evalScript,
  scan,
  getPrefixedKey,
  healthCheck,
};
