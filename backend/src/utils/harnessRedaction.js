const crypto = require('crypto');

/**
 * Defense-in-depth redaction for harness events (fg-41 FR4, fg-42 groundwork).
 *
 * The supervisor redacts before emission, but events cross a process and an
 * HTTP boundary. This module re-scans every payload at ingest, drops credential
 * values, hashes long file/prompt content, caps string size and flags any
 * credential-shaped value that had to be redacted so alerts can fire.
 */

const DEFAULT_MAX_STRING = 4096;
const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_MAX_ARRAY = 200;
const DEFAULT_MAX_KEYS = 200;

const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|authorization|credential|cookie|session[_-]?key|access[_-]?key)/i;

const HASH_CONTENT_KEYS = new Set([
  'content',
  'filecontent',
  'file_content',
  'fullpatch',
  'full_patch',
  'patch',
  'prompt',
  'prompttext',
  'prompt_text',
  'body',
]);

const PREVIEW_CONTENT_KEYS = new Set([
  'output',
  'stdout',
  'stderr',
  'log',
  'logs',
  'message',
]);

const SECRET_PATTERNS = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi,
    replace: () => '[REDACTED PRIVATE KEY]',
  },
  {
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?(?:-----END PGP PRIVATE KEY BLOCK-----|$)/gi,
    replace: () => '[REDACTED PRIVATE KEY]',
  },
  {
    pattern: /---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----[\s\S]*?(?:---- END SSH2 ENCRYPTED PRIVATE KEY ----|$)/gi,
    replace: () => '[REDACTED PRIVATE KEY]',
  },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9._-]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: () => '[REDACTED]',
  },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replace: () => '[REDACTED]' },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => '[REDACTED]' },
  { pattern: /\bxox[abpcrsd]-[A-Za-z0-9-]{10,}\b/g, replace: () => '[REDACTED]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => '[REDACTED]' },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => '[REDACTED]',
  },
  {
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    replace: (_match, scheme) => `${scheme} [REDACTED]`,
  },
  {
    pattern: /(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]*):([^/\s@]+)@/gi,
    replace: (_match, scheme) => `${scheme}[REDACTED]@`,
  },
  {
    pattern: /(?<![\w.-])(?=[\w.-]*(?:api[_-]?key|private[_-]?key|secret|token|password|passwd|pwd|authorization|pass[_-]?phrase))([\w.-]+)(["']?)(\s*[:=]\s*)(?:"((?:[^"\\]|\\.){8,})"|'((?:[^'\\]|\\.){8,})'|([^"'\r\n]{8,}))/gi,
    replace: (_match, key, quote, separator) => {
      const closing = quote === '"' ? '"' : (quote === "'" ? "'" : '');
      return `${key}${quote || ''}${separator}[REDACTED]${closing}`;
    },
  },
];

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function maxStringLength() {
  return positiveInt(process.env.HARNESS_EVENT_MAX_STRING, DEFAULT_MAX_STRING);
}

function redactPatterns(value) {
  let redacted = value;
  let changed = false;
  for (const rule of SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0;
    redacted = redacted.replace(rule.pattern, (...args) => {
      changed = true;
      return rule.replace(...args);
    });
  }
  return { value: redacted, changed };
}

function digestContent(value) {
  const text = String(value);
  return {
    redacted: 'content',
    sha256: sha256(text),
    length: text.length,
  };
}

function redactString(value, key, ctx) {
  if (typeof value !== 'string') {
    return value;
  }
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    ctx.redactedFields.add(key);
    ctx.secretFlagged = true;
    return '[REDACTED]';
  }
  if (key && HASH_CONTENT_KEYS.has(key.toLowerCase())) {
    ctx.hashedFields.add(key);
    return digestContent(value);
  }

  const result = redactPatterns(value);
  let output = result.value;
  if (result.changed) {
    ctx.secretFlagged = true;
    ctx.redactedFields.add(key || 'value');
  }

  if (key && PREVIEW_CONTENT_KEYS.has(key.toLowerCase())) {
    const limit = Math.min(maxStringLength(), 2000);
    if (output.length > limit) {
      ctx.truncated = true;
      output = `${output.slice(0, limit)}...[TRUNCATED sha256:${sha256(output)}]`;
    }
    return output;
  }

  const limit = maxStringLength();
  if (output.length > limit) {
    ctx.truncated = true;
    return {
      redacted: 'truncated',
      sha256: sha256(output),
      length: output.length,
      preview: output.slice(0, limit),
    };
  }
  return output;
}

function redactValue(value, key, ctx, depth) {
  if (depth > ctx.maxDepth) {
    ctx.truncated = true;
    return '[TRUNCATED: max depth]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value, key, ctx);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > ctx.maxArray) {
      ctx.truncated = true;
    }
    return value
      .slice(0, ctx.maxArray)
      .map((item) => redactValue(item, key, ctx, depth + 1));
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > ctx.maxKeys) {
      ctx.truncated = true;
    }
    const output = {};
    for (const childKey of keys.slice(0, ctx.maxKeys)) {
      output[childKey] = redactValue(value[childKey], childKey, ctx, depth + 1);
    }
    return output;
  }
  return '[UNSUPPORTED]';
}

/**
 * Redact one event payload.
 *
 * @param {object} payload
 * @param {{maxDepth?:number, maxArray?:number, maxKeys?:number}} [options]
 * @returns {{payload: object, secretFlagged: boolean, redactedFields: string[],
 *   hashedFields: string[], truncated: boolean}}
 */
function redactPayload(payload, options = {}) {
  const ctx = {
    maxDepth: positiveInt(options.maxDepth, DEFAULT_MAX_DEPTH),
    maxArray: positiveInt(options.maxArray, DEFAULT_MAX_ARRAY),
    maxKeys: positiveInt(options.maxKeys, DEFAULT_MAX_KEYS),
    secretFlagged: false,
    redactedFields: new Set(),
    hashedFields: new Set(),
    truncated: false,
  };

  let safePayload;
  try {
    safePayload = redactValue(payload, null, ctx, 0);
  } catch {
    ctx.truncated = true;
    safePayload = { redacted: 'payload', error: 'redaction_failed' };
  }
  if (safePayload === null || typeof safePayload !== 'object' || Array.isArray(safePayload)) {
    safePayload = { value: safePayload };
  }
  if (ctx.secretFlagged || ctx.redactedFields.size > 0 || ctx.hashedFields.size > 0) {
    safePayload._redaction = {
      version: 1,
      secret_flagged: ctx.secretFlagged,
      redacted_fields: Array.from(ctx.redactedFields).sort(),
      hashed_fields: Array.from(ctx.hashedFields).sort(),
      truncated: ctx.truncated,
    };
  }

  return {
    payload: safePayload,
    secretFlagged: ctx.secretFlagged,
    redactedFields: Array.from(ctx.redactedFields).sort(),
    hashedFields: Array.from(ctx.hashedFields).sort(),
    truncated: ctx.truncated,
  };
}

function containsSecret(value) {
  const result = redactPayload({ value });
  return result.secretFlagged;
}

module.exports = {
  redactPayload,
  containsSecret,
  sha256,
  SENSITIVE_KEY_PATTERN,
};
