const EventHashService = require('../../src/services/EventHashService');

describe('EventHashService', () => {
  describe('canonicalize', () => {
    it('should sort keys at top level', () => {
      const result = EventHashService.canonicalize({ b: 2, a: 1 });
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('should sort keys recursively', () => {
      const result = EventHashService.canonicalize({ a: { c: 3, b: 2 } });
      expect(result).toBe('{"a":{"b":2,"c":3}}');
    });

    it('should handle nested objects', () => {
      const result = EventHashService.canonicalize({ z: 1, a: { y: 2, b: { x: 3 } } });
      expect(result).toBe('{"a":{"b":{"x":3},"y":2},"z":1}');
    });

    it('should handle arrays', () => {
      const result = EventHashService.canonicalize({ items: [3, 1, 2], name: 'test' });
      expect(result).toBe('{"items":[3,1,2],"name":"test"}');
    });

    it('should handle empty object', () => {
      const result = EventHashService.canonicalize({});
      expect(result).toBe('{}');
    });
  });

  describe('computeHash', () => {
    it('should return a 64-char hex string', () => {
      const hash = EventHashService.computeHash({ a: 1 });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic', () => {
      const hash1 = EventHashService.computeHash({ a: 1 });
      const hash2 = EventHashService.computeHash({ a: 1 });
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different input', () => {
      const hash1 = EventHashService.computeHash({ a: 1 });
      const hash2 = EventHashService.computeHash({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash regardless of key order', () => {
      const hash1 = EventHashService.computeHash({ a: 1, b: 2 });
      const hash2 = EventHashService.computeHash({ b: 2, a: 1 });
      expect(hash1).toBe(hash2);
    });

    it('should handle empty object consistently', () => {
      const hash1 = EventHashService.computeHash({});
      const hash2 = EventHashService.computeHash({});
      expect(hash1).toBe(hash2);
    });

    it('should handle complex nested objects', () => {
      const payload = {
        schema_version: 1,
        provider_type: 'claude',
        model: 'claude-sonnet-4-20250514',
        raw_provider_fields: { input_tokens: 150, output_tokens: 50 },
        normalized_fields: { tokens_in: 150, tokens_out: 50 },
        derived_metrics: { cost_usd: 0.0006 },
      };
      const hash1 = EventHashService.computeHash(payload);
      const hash2 = EventHashService.computeHash(payload);
      expect(hash1).toBe(hash2);
    });
  });
});
