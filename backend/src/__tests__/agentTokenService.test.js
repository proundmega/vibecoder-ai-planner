const AgentTokenService = require('../services/AgentTokenService');

describe('AgentTokenService (FR1, FR4, FR5, NFR1)', () => {
  it('generates prefixed, high-entropy tokens', () => {
    const enrollment = AgentTokenService.generate('enrollment');
    const access = AgentTokenService.generate('access');
    const refresh = AgentTokenService.generate('refresh');

    expect(enrollment).toMatch(/^enr_[A-Za-z0-9_-]{43}$/);
    expect(access).toMatch(/^at_[A-Za-z0-9_-]{43}$/);
    expect(refresh).toMatch(/^ar_[A-Za-z0-9_-]{43}$/);
    expect(AgentTokenService.generate('access')).not.toBe(access);
  });

  it('stores a SHA-256 hash and a short lookup prefix, never the raw value', () => {
    const token = AgentTokenService.generate('access');
    const hash = AgentTokenService.hash(token);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(AgentTokenService.lookupPrefix(token)).toBe(token.slice(0, 12));
    expect(AgentTokenService.lookupPrefix(token).length).toBeLessThan(token.length);
  });

  it('dispatches token kinds by prefix and ignores unknown shapes', () => {
    expect(AgentTokenService.kindOf('enr_abc')).toBe('enrollment');
    expect(AgentTokenService.kindOf('at_abc')).toBe('access');
    expect(AgentTokenService.kindOf('ar_abc')).toBe('refresh');
    expect(AgentTokenService.kindOf('ak_abc')).toBe('legacy');
    expect(AgentTokenService.kindOf('nope')).toBeNull();
    expect(AgentTokenService.kindOf(null)).toBeNull();
  });

  it('compares hashes in constant time and rejects mismatches', () => {
    const token = AgentTokenService.generate('refresh');
    const hash = AgentTokenService.hash(token);

    expect(AgentTokenService.matches(token, hash)).toBe(true);
    expect(AgentTokenService.matches(token, AgentTokenService.hash('other'))).toBe(false);
    expect(AgentTokenService.matches(token, 'short')).toBe(false);
  });
});
