const REDACTED = '[REDACTED]';

const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]*):(?!\$\{password\})[^/\s@]+@/gi;
const CLIENT_NAME = '(?:[Mm][Yy][Ss][Qq][Ll]|[Mm][Aa][Rr][Ii][Aa][Dd][Bb]|[Mm][Yy][Ss][Qq][Ll][Aa][Dd][Mm][Ii][Nn]|[Mm][Yy][Ss][Qq][Ll][Dd][Uu][Mm][Pp]|[Mm][Aa][Rr][Ii][Aa][Dd][Bb]-[Aa][Dd][Mm][Ii][Nn]|[Mm][Aa][Rr][Ii][Aa][Dd][Bb]-[Dd][Uu][Mm][Pp])';
const SHORT_MYSQL = new RegExp('(\\b' + CLIENT_NAME + '\\b[^\\n;&|]*?\\s-p)(?:\\s*=\\s*|\\s*)("[^"]*"|\'[^\']*\'|[^\\s;&|]+)', 'g');
const SHORT_REDIS = /(\bredis-cli\b[^\n;&|]*?\s-a)(?:\s*=\s*|\s*)("[^"]*"|'[^']*'|[^\s;&|]+)/g;
const REDISCLI_AUTH = /(\bREDISCLI_AUTH\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;&|]+)/g;
const KEY_VALUE = /(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)(\s*(?::|=(?!=))\s*)("[^"]*"|'[^']*'|[^\s;&|]+)/g;
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*/gi;
const GENERATED_PASSWORD = /(?<!sha256:)\b[0-9a-f]{64}\b/gi;
const LONG_TOKEN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bxox[abpcrsd]-[A-Za-z0-9-]{10,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/gi;

const SECRET_KEY_PRIMARY = /(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|credential|pass(?:word|wd|phrase)|rediscli[_-]?auth|authorization)/i;
const SECRET_KEY_SEGMENT = /(?:^|_)(?:key|pass|pwd|auth)(?:$|_)/i;
const SECRET_KEY_SUFFIX = /(?:pass|pwd)$/i;

function isSecretKey(name) {
  if (name == null) return false;
  const value = String(name);
  return SECRET_KEY_PRIMARY.test(value)
    || SECRET_KEY_SEGMENT.test(value)
    || SECRET_KEY_SUFFIX.test(value);
}

function isEnvReference(value) {
  const text = String(value || '').replace(/^["']|["']$/g, '');
  return /^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/.test(text);
}

function redactText(value) {
  if (typeof value !== 'string' || value === '') return value;
  let text = value;
  text = text.replace(PRIVATE_KEY, '[REDACTED PRIVATE KEY]');
  text = text.replace(LONG_TOKEN, REDACTED);
  text = text.replace(BEARER, '$1 ' + REDACTED);
  text = text.replace(URL_USERINFO, '$1[REDACTED]@');
  text = text.replace(KEY_VALUE, (match, lead, key, separator, token) => {
    const value = token.replace(/^["']|["']$/g, '');
    if (!isSecretKey(key) || isEnvReference(value)) return match;
    const quote = token.startsWith('"') ? '"' : (token.startsWith("'") ? "'" : '');
    return `${lead}${key}${separator}${quote}${REDACTED}${quote}`;
  });
  text = text.replace(SHORT_MYSQL, (match, prefix, secret) => (
    isEnvReference(secret) || secret.replace(/^["']/, '').startsWith('-')
      ? match
      : `${prefix} ${REDACTED}`
  ));
  text = text.replace(SHORT_REDIS, (match, prefix, secret) => (
    isEnvReference(secret) || secret.replace(/^["']/, '').startsWith('-')
      ? match
      : `${prefix} ${REDACTED}`
  ));
  text = text.replace(REDISCLI_AUTH, (match, prefix, secret) => (
    isEnvReference(secret) ? match : `${prefix}${REDACTED}`
  ));
  text = text.replace(GENERATED_PASSWORD, REDACTED);
  return text;
}

function redactStringMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
  const output = { ...map };
  for (const key of Object.keys(output)) {
    output[key] = isSecretKey(key) ? REDACTED : redactText(output[key]);
  }
  return output;
}

/**
 * Read-time scrub for legacy rows that may contain literal credentials from
 * before the validators rejected them. The stored row is never mutated.
 */
function redactProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return profile;
  }
  const output = JSON.parse(JSON.stringify(profile));
  if (Array.isArray(output.setup)) output.setup = output.setup.map(redactText);
  if (Array.isArray(output.verify)) output.verify = output.verify.map(redactText);
  if (output.env) output.env = redactStringMap(output.env);
  if (Array.isArray(output.services)) {
    output.services = output.services.map((service) => {
      if (!service || typeof service !== 'object') return service;
      const copy = { ...service };
      if (copy.env) copy.env = redactStringMap(copy.env);
      if (typeof copy.connection_url === 'string') {
        copy.connection_url = redactText(copy.connection_url);
      }
      if (copy.healthcheck && typeof copy.healthcheck.command === 'string') {
        copy.healthcheck = {
          ...copy.healthcheck,
          command: redactText(copy.healthcheck.command),
        };
      }
      return copy;
    });
  }
  return output;
}

function redactResult(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactResult);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value)) {
      output[key] = isSecretKey(key) ? REDACTED : redactResult(value[key]);
    }
    return output;
  }
  return value;
}

module.exports = {
  redactText,
  redactProfile,
  redactResult,
};
