const crypto = require('crypto');

class EventHashService {
  /**
   * Recursively sort object keys for deterministic serialization.
   * @param {any} obj - value to canonicalize
   * @returns {any} canonicalized value
   */
  static _sortKeys(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => EventHashService._sortKeys(item));
    const sorted = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = EventHashService._sortKeys(obj[key]);
    }
    return sorted;
  }

  /**
   * Deterministic JSON serialization: sorted keys recursively, no whitespace.
   * @param {Object} obj - object to canonicalize
   * @returns {string} canonical JSON string
   */
  static canonicalize(obj) {
    return JSON.stringify(EventHashService._sortKeys(obj));
  }

  /**
   * Compute SHA-256 content hash of a payload.
   * @param {Object} payload - the three-layer payload object
   * @returns {string} 64-char hex SHA-256 hash
   */
  static computeHash(payload) {
    const canonical = EventHashService.canonicalize(payload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}

module.exports = EventHashService;
