const {
  normaliseEndpoint,
  resolveProviderEndpoint,
  providerCatalog,
} = require('../utils/providerDefaults');

describe('provider endpoint resolution', () => {
  it('trims a configured endpoint', () => {
    expect(normaliseEndpoint('  https://example.test/v1  ')).toBe('https://example.test/v1');
  });

  it('treats blank and non-string values as unset', () => {
    expect(normaliseEndpoint('')).toBeNull();
    expect(normaliseEndpoint('   ')).toBeNull();
    expect(normaliseEndpoint(null)).toBeNull();
    expect(normaliseEndpoint(undefined)).toBeNull();
  });

  it('prefers base_url, then endpoint_url', () => {
    expect(resolveProviderEndpoint({
      providerType: 'opencode',
      baseUrl: 'https://proxy.internal/base',
      endpointUrl: 'https://proxy.internal/endpoint',
    })).toBe('https://proxy.internal/base');
  });

  it('ignores a blank base_url so endpoint_url wins', () => {
    expect(resolveProviderEndpoint({
      providerType: 'opencode',
      baseUrl: '',
      endpointUrl: 'https://proxy.internal/endpoint',
    })).toBe('https://proxy.internal/endpoint');
  });

  it('falls back to the provider default endpoint', () => {
    expect(resolveProviderEndpoint({ providerType: 'opencode' }))
      .toBe('https://opencode.ai/zen/v1');
    expect(resolveProviderEndpoint({ providerType: 'opencode-go', baseUrl: ' ' }))
      .toBe('https://opencode.ai/zen/go/v1');
  });

  it('returns null when nothing is configured', () => {
    expect(resolveProviderEndpoint({ providerType: 'openai' })).toBeNull();
  });

  it('exposes the defaults catalog for the UI', () => {
    expect(providerCatalog()).toEqual([
      {
        type: 'opencode',
        label: 'OpenCode (Zen)',
        endpointUrl: 'https://opencode.ai/zen/v1',
        requiresModel: true,
      },
      {
        type: 'opencode-go',
        label: 'OpenCode Go',
        endpointUrl: 'https://opencode.ai/zen/go/v1',
        requiresModel: true,
      },
    ]);
  });
});
