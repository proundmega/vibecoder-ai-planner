const crypto = require('crypto');

const TOKEN_PREFIX_LENGTH = 12;

/**
 * Generate and inspect agent enrollment credentials.
 *
 * Join (`enr_`), access (`at_`) and refresh (`ar_`) tokens are 256-bit random
 * values with an explicit prefix so auth can dispatch without guessing. Only a
 * SHA-256 hash and a short lookup prefix are persisted: the raw value is
 * returned once and never stored.
 */
class AgentTokenService {
  static prefixFor(kind) {
    switch (kind) {
      case 'enrollment': return 'enr_';
      case 'access': return 'at_';
      case 'refresh': return 'ar_';
      default: throw new Error(`Unknown agent token kind: ${kind}`);
    }
  }

  static generate(kind) {
    const prefix = this.prefixFor(kind);
    return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
  }

  static hash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  static lookupPrefix(token) {
    return token.slice(0, TOKEN_PREFIX_LENGTH);
  }

  static kindOf(token) {
    if (typeof token !== 'string') return null;
    if (token.startsWith('enr_')) return 'enrollment';
    if (token.startsWith('at_')) return 'access';
    if (token.startsWith('ar_')) return 'refresh';
    if (token.startsWith('ak_')) return 'legacy';
    return null;
  }

  /** Constant-time comparison between the presented value's hash and a row hash. */
  static matches(token, expectedHash) {
    if (typeof expectedHash !== 'string' || expectedHash.length !== 64) return false;
    const actual = Buffer.from(this.hash(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  }
}

module.exports = AgentTokenService;
