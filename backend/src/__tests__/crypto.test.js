const { maskToken } = require('../utils/crypto');

describe('maskToken', () => {
  describe('BP-51-12: Edge case for short tokens', () => {
    test('should return **** for null token', () => {
      expect(maskToken(null)).toBe('****');
    });

    test('should return **** for undefined token', () => {
      expect(maskToken(undefined)).toBe('****');
    });

    test('should return **** for empty string', () => {
      expect(maskToken('')).toBe('****');
    });

    test('should return **** for 1-char token', () => {
      expect(maskToken('a')).toBe('****');
    });

    test('should return **** for 4-char token', () => {
      expect(maskToken('abcd')).toBe('****');
    });

    test('should show last 4 chars for 5-char token (BP-51-12 regression)', () => {
      // 'abcde' → visible='bcde', maskedLen=min(1,15)=1 → '*bcde'
      expect(maskToken('abcde')).toBe('*bcde');
    });

    test('should show last 4 chars for 7-char token (BP-51-12 regression)', () => {
      // 'abcdefg' → visible='defg', maskedLen=min(3,15)=3 → '***defg'
      expect(maskToken('abcdefg')).toBe('***defg');
    });

    test('should show last 4 chars for 8-char token (BP-51-12 regression - previously returned ****)', () => {
      // 'abcdefgh' → visible='efgh', maskedLen=min(4,15)=4 → '****efgh'
      expect(maskToken('abcdefgh')).toBe('****efgh');
    });
  });

  describe('normal token masking', () => {
    test('should mask long tokens showing last 4 chars', () => {
      // 'sk-ant-api03-long-token-1234567890' (32 chars) → maskedLen=min(28,15)=15, visible='7890'
      expect(maskToken('sk-ant-api03-long-token-1234567890')).toBe('***************7890');
    });

    test('should mask exactly 15 chars for very long tokens', () => {
      // 50 'a's + 'last4' = 54 chars → maskedLen=min(50,15)=15, visible='ast4'
      const longToken = 'a'.repeat(50) + 'last4';
      expect(maskToken(longToken)).toBe('*'.repeat(15) + 'ast4');
    });
  });
});
